import crypto from "crypto";
import { NextResponse } from "next/server";
import {
  fetchAllOnChainCreators,
  fetchOnChainCreatorByUsername,
  fetchOnChainCreatorByWallet,
  fetchSignaturesPaginated,
  fetchVerifiedTransactionTip,
  markSignatureProcessed,
  pushVerifiedTipToMemory,
  type OnChainCreator,
} from "@/lib/solanaServer";
import {
  getCreatorFromDb,
  getExistingTipSignaturesInDb,
  upsertCreatorInDb,
  syncCreatorExactStatsInDb,
  insertTipInDb,
  isPostgresUniqueViolation,
} from "@/lib/supabaseDb";

function secretsMatch(provided: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function isAuthorized(req: Request): { ok: boolean; status: number; error?: string } {
  const expected =
    process.env.SOLSTREAM_RECOVERY_SECRET || process.env.CRON_SECRET || "";
  if (!expected) {
    return { ok: false, status: 503, error: "Recovery secret is not configured" };
  }

  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const headerToken = (req.headers.get("x-recovery-secret") || "").trim();
  const provided = bearerToken || headerToken;

  if (!provided || !secretsMatch(provided, expected)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true, status: 200 };
}

async function handleRecovery(
  targetUsername?: string,
  explicitSignatures?: string[],
  maxSignatures?: number
) {
  let creators: OnChainCreator[] = [];
  if (targetUsername) {
    const one = await fetchOnChainCreatorByUsername(targetUsername, true);
    if (one) creators = [one];
  } else {
    creators = await fetchAllOnChainCreators(true);
  }

  let scannedSignatures = 0;
  let recoveredCount = 0;
  let skippedExisting = 0;
  let rejectedInvalid = 0;
  const perCreator: Array<{
    username: string;
    scanned: number;
    recovered: number;
  }> = [];

  for (const chainCreator of creators) {
    let dbCreator = null;
    try {
      dbCreator = await getCreatorFromDb(chainCreator.username);
      if (!dbCreator) {
        dbCreator = await upsertCreatorInDb(chainCreator);
      }
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        console.warn(
          `Recovery skipping duplicate handle "${chainCreator.username}" (${chainCreator.authority})`
        );
        continue;
      }
      throw err;
    }

    if (!dbCreator?.id) continue;

    const sigList =
      explicitSignatures && explicitSignatures.length > 0
        ? explicitSignatures
        : (await fetchSignaturesPaginated(chainCreator.pda, maxSignatures)).map(
            (s) => s.signature
          );

    scannedSignatures += sigList.length;
    const existingSet = await getExistingTipSignaturesInDb(sigList);

    let creatorRecovered = 0;
    for (const sig of sigList) {
      if (existingSet.has(sig)) {
        skippedExisting += 1;
        continue;
      }

      // Strictly verify with Fix 1 verifier (no TTS generation in background recovery)
      const tip = await fetchVerifiedTransactionTip(sig, chainCreator.authority);
      if (!tip) {
        rejectedInvalid += 1;
        continue;
      }

      const dbRes = await insertTipInDb(
        dbCreator.id,
        chainCreator.username,
        { ...tip, audioUrl: null },
        null
      );

      if (dbRes.inserted) {
        creatorRecovered += 1;
        recoveredCount += 1;
        markSignatureProcessed(sig);
        pushVerifiedTipToMemory(chainCreator.username, {
          ...tip,
          audioUrl: null,
        });
      } else {
        skippedExisting += 1;
      }
    }

    // Reconcile exact on-chain stats so counters never drift or double-count
    try {
      const freshCreator =
        (await fetchOnChainCreatorByWallet(chainCreator.authority)) ||
        chainCreator;
      await syncCreatorExactStatsInDb(freshCreator);
    } catch (err) {
      if (!isPostgresUniqueViolation(err)) {
        console.warn(
          `Recovery post-sync warning for @${chainCreator.username}:`,
          err
        );
      }
    }

    perCreator.push({
      username: chainCreator.username,
      scanned: sigList.length,
      recovered: creatorRecovered,
    });
  }

  return {
    ok: true,
    creatorsChecked: creators.length,
    scannedSignatures,
    recoveredCount,
    skippedExisting,
    rejectedInvalid,
    perCreator,
  };
}

export async function GET(req: Request) {
  const auth = isAuthorized(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const username = searchParams.get("username")?.trim().toLowerCase() || undefined;
    const capParam = Number(searchParams.get("limit") || "");
    const maxSignatures =
      Number.isFinite(capParam) && capParam > 0 ? capParam : undefined;

    const summary = await handleRecovery(username, undefined, maxSignatures);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("GET /api/tips/recover failed:", err);
    return NextResponse.json(
      { error: "Missed-tip recovery failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const auth = isAuthorized(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const username =
      typeof body?.username === "string"
        ? body.username.trim().toLowerCase() || undefined
        : undefined;
    const explicitSignatures = Array.isArray(body?.signatures)
      ? body.signatures.filter(
          (s: unknown): s is string => typeof s === "string" && s.trim().length > 0
        )
      : undefined;
    const capNum = Number(body?.maxSignatures);
    const maxSignatures =
      Number.isFinite(capNum) && capNum > 0 ? capNum : undefined;

    const summary = await handleRecovery(
      username,
      explicitSignatures,
      maxSignatures
    );
    return NextResponse.json(summary);
  } catch (err) {
    console.error("POST /api/tips/recover failed:", err);
    return NextResponse.json(
      { error: "Missed-tip recovery failed" },
      { status: 500 }
    );
  }
}

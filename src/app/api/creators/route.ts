import { NextResponse } from "next/server";
import {
  fetchAllOnChainCreators,
  type OnChainCreator,
} from "@/lib/solanaServer";
import {
  getCreatorsFromDb,
  syncCreatorExactStatsInDb,
  isPostgresUniqueViolation,
  type DbCreatorRow,
} from "@/lib/supabaseDb";
import {
  checkRateLimit,
  getClientIp,
  rateLimitJsonResponse,
} from "@/lib/rateLimit";

function needsCreatorSync(dbRow: DbCreatorRow | undefined, chain: OnChainCreator): boolean {
  if (!dbRow) return true;
  return (
    dbRow.username !== chain.username ||
    dbRow.pda !== chain.pda ||
    dbRow.voiceId !== chain.voiceId ||
    dbRow.goalTitle !== chain.goalTitle ||
    dbRow.goalTargetLamports !== chain.goalTargetLamports ||
    dbRow.goalCurrentLamports !== chain.goalCurrentLamports ||
    dbRow.totalTips !== chain.totalTips ||
    dbRow.totalVolume !== chain.totalVolume
  );
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fresh = searchParams.get("fresh") === "1";

  if (fresh) {
    const rl = checkRateLimit("creators_fresh", getClientIp(req), 10, 60_000);
    if (!rl.allowed) {
      return rateLimitJsonResponse(rl.retryAfterSeconds);
    }
  }

  let dbCreators: DbCreatorRow[] = [];
  let dbHealthy = false;
  try {
    dbCreators = await getCreatorsFromDb();
    dbHealthy = true;
  } catch (err) {
    console.warn("GET /api/creators DB read failed, serving chain data:", err);
  }

  let chainCreators: OnChainCreator[] = [];
  let chainHealthy = false;
  try {
    chainCreators = await fetchAllOnChainCreators(fresh);
    chainHealthy = true;
  } catch (err) {
    console.warn("GET /api/creators Solana fetch failed:", err);
  }

  if (!dbHealthy && !chainHealthy) {
    return NextResponse.json(
      { error: "Failed to fetch creators" },
      { status: 500 }
    );
  }

  // Sync chain creators into DB only when missing or stats/fields differ
  if (dbHealthy && chainCreators.length > 0) {
    const dbByAuthority = new Map(dbCreators.map((r) => [r.authority, r]));
    let syncedAny = false;
    for (const c of chainCreators) {
      if (!needsCreatorSync(dbByAuthority.get(c.authority), c)) continue;
      try {
        await syncCreatorExactStatsInDb(c);
        syncedAny = true;
      } catch (err) {
        if (isPostgresUniqueViolation(err)) {
          console.warn(
            `Skipping duplicate handle "${c.username}" for wallet ${c.authority} (23505)`
          );
        } else {
          console.warn(`DB sync warning for @${c.username}:`, err);
        }
      }
    }

    if (syncedAny) {
      try {
        dbCreators = await getCreatorsFromDb();
      } catch (err) {
        console.warn("GET /api/creators DB re-read warning:", err);
      }
    }
  }

  // Merge DB + chain creators; chain always wins for live stats
  const mergedByAuthority = new Map<string, OnChainCreator & { id?: string }>();
  for (const dbRow of dbCreators) {
    mergedByAuthority.set(dbRow.authority, dbRow);
  }
  for (const chainRow of chainCreators) {
    const existing = mergedByAuthority.get(chainRow.authority);
    mergedByAuthority.set(
      chainRow.authority,
      existing
        ? { ...existing, ...chainRow, id: existing.id }
        : chainRow
    );
  }

  const creators = Array.from(mergedByAuthority.values());
  const source = !dbHealthy
    ? "solana"
    : chainCreators.length > 0
    ? "solana+supabase"
    : "supabase";

  return NextResponse.json({ creators, source });
}

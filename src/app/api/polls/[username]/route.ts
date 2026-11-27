import { NextResponse } from "next/server";
import { fetchOnChainCreatorByUsername } from "@/lib/solanaServer";
import {
  getCreatorFromDb,
  upsertCreatorInDb,
  getPollWithResultsFromDb,
  upsertCreatorPollInDb,
  ensureDbReady,
} from "@/lib/supabaseDb";
import { verifySolanaWalletSignature } from "@/lib/verifyWalletSig";
import {
  checkRateLimit,
  getClientIp,
  rateLimitJsonResponse,
} from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const MAX_SIG_AGE_MS = 10 * 60 * 1000;

export async function GET(
  _req: Request,
  context: { params: Promise<{ username: string }> }
) {
  try {
    const { username: rawUsername } = await context.params;
    const username = rawUsername.trim().toLowerCase();
    const poll = await getPollWithResultsFromDb(username);
    return NextResponse.json({ poll });
  } catch (err) {
    console.error("GET /api/polls/[username] error:", err);
    return NextResponse.json(
      { error: "Failed to load poll" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ username: string }> }
) {
  try {
    const rl = checkRateLimit("polls_write", getClientIp(req), 15, 60_000);
    if (!rl.allowed) {
      return rateLimitJsonResponse(rl.retryAfterSeconds);
    }

    const dbReady = await ensureDbReady();
    if (!dbReady) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }

    const { username: rawUsername } = await context.params;
    const username = rawUsername.trim().toLowerCase();
    const body = await req.json().catch(() => null);

    const walletAddress =
      typeof body?.walletAddress === "string" ? body.walletAddress.trim() : "";
    const signedMessage =
      typeof body?.signedMessage === "string" ? body.signedMessage : "";
    const signature =
      typeof body?.signature === "string" ? body.signature.trim() : "";
    const timestampMs = Number(body?.timestampMs || 0);

    if (
      !walletAddress ||
      !signedMessage ||
      !signature ||
      !Number.isFinite(timestampMs)
    ) {
      return NextResponse.json(
        { error: "Missing creator wallet signature" },
        { status: 400 }
      );
    }

    if (Math.abs(Date.now() - timestampMs) > MAX_SIG_AGE_MS) {
      return NextResponse.json(
        { error: "Poll signature expired. Please sign again." },
        { status: 401 }
      );
    }

    const expectedPrefix = `solstream:poll:${username}:${timestampMs}:`;
    if (!signedMessage.startsWith(expectedPrefix)) {
      return NextResponse.json(
        { error: "Invalid poll signature payload" },
        { status: 401 }
      );
    }

    if (!verifySolanaWalletSignature(walletAddress, signedMessage, signature)) {
      return NextResponse.json(
        { error: "Invalid wallet signature" },
        { status: 401 }
      );
    }

    const chainCreator = await fetchOnChainCreatorByUsername(username);
    if (!chainCreator || chainCreator.authority !== walletAddress) {
      return NextResponse.json(
        { error: "Wallet does not match on-chain creator authority" },
        { status: 403 }
      );
    }

    let dbCreator = await getCreatorFromDb(username);
    if (!dbCreator) {
      dbCreator = await upsertCreatorInDb(chainCreator);
    }
    if (!dbCreator?.id) {
      return NextResponse.json(
        { error: "Creator record unavailable" },
        { status: 503 }
      );
    }

    const action = body?.action === "close" ? "close" : "upsert";
    if (action === "close") {
      const existing = await getPollWithResultsFromDb(username);
      const closed = await upsertCreatorPollInDb({
        creatorId: dbCreator.id,
        username,
        question: existing?.question || "Stream Poll",
        optionA: existing?.optionA || "Option A",
        optionB: existing?.optionB || "Option B",
        minVoteLamports: existing?.minVoteLamports || 1_000_000,
        isActive: false,
        resetCounts: false,
      });
      return NextResponse.json({ poll: closed });
    }

    const question =
      typeof body?.question === "string" ? body.question.trim() : "";
    const optionA =
      typeof body?.optionA === "string" ? body.optionA.trim() : "";
    const optionB =
      typeof body?.optionB === "string" ? body.optionB.trim() : "";
    const minVoteSol = Number(body?.minVoteSol ?? 0.005);

    if (
      !question ||
      question.length > 80 ||
      !optionA ||
      optionA.length > 32 ||
      !optionB ||
      optionB.length > 32
    ) {
      return NextResponse.json(
        {
          error:
            "Question (1-80 chars) and two options (1-32 chars each) are required",
        },
        { status: 400 }
      );
    }

    const minVoteLamports = Math.max(
      1_000_000,
      Math.round((Number.isFinite(minVoteSol) ? minVoteSol : 0.005) * 1_000_000_000)
    );

    const poll = await upsertCreatorPollInDb({
      creatorId: dbCreator.id,
      username,
      question,
      optionA,
      optionB,
      minVoteLamports,
      isActive: true,
      resetCounts: true,
    });

    return NextResponse.json({ poll });
  } catch (err) {
    console.error("POST /api/polls/[username] error:", err);
    return NextResponse.json(
      { error: "Failed to save creator poll" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  fetchOnChainCreatorByWallet,
  invalidateCreatorCache,
} from "@/lib/solanaServer";
import {
  getCreatorFromDb,
  syncCreatorExactStatsInDb,
  isPostgresUniqueViolation,
} from "@/lib/supabaseDb";
import {
  checkRateLimit,
  getClientIp,
  rateLimitJsonResponse,
} from "@/lib/rateLimit";

export async function POST(req: Request) {
  try {
    const rl = checkRateLimit("register", getClientIp(req), 10, 60_000);
    if (!rl.allowed) {
      return rateLimitJsonResponse(rl.retryAfterSeconds);
    }

    const body = await req.json().catch(() => null);
    const walletAddress =
      typeof body?.walletAddress === "string" ? body.walletAddress.trim() : "";

    if (!walletAddress) {
      return NextResponse.json(
        { error: "Missing walletAddress" },
        { status: 400 }
      );
    }

    try {
      new PublicKey(walletAddress);
    } catch {
      return NextResponse.json(
        { error: "Invalid walletAddress" },
        { status: 400 }
      );
    }

    // Zero-trust: always verify creator PDA account directly on Solana Devnet
    const onChainCreator = await fetchOnChainCreatorByWallet(walletAddress);
    if (!onChainCreator) {
      return NextResponse.json(
        { error: "No CreatorAccount PDA found on Solana Devnet for this wallet" },
        { status: 404 }
      );
    }

    const existingByHandle = await getCreatorFromDb(onChainCreator.username);
    if (
      existingByHandle &&
      existingByHandle.authority !== onChainCreator.authority
    ) {
      return NextResponse.json(
        {
          error: `Handle @${onChainCreator.username} is already registered to another wallet`,
        },
        { status: 409 }
      );
    }

    let saved = null;
    try {
      saved = await syncCreatorExactStatsInDb(onChainCreator);
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        return NextResponse.json(
          {
            error: `Handle @${onChainCreator.username} is already registered to another wallet`,
          },
          { status: 409 }
        );
      }
      throw err;
    }

    invalidateCreatorCache(onChainCreator.username);

    return NextResponse.json({
      registered: true,
      creator: saved || onChainCreator,
    });
  } catch (err) {
    console.error("POST /api/creators/register error:", err);
    return NextResponse.json(
      { error: "Failed to register creator" },
      { status: 500 }
    );
  }
}

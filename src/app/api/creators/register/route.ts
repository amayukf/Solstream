import { NextResponse } from "next/server";
import {
  fetchOnChainCreatorByWallet,
  invalidateCreatorCache,
} from "@/lib/solanaServer";
import { syncCreatorExactStatsInDb } from "@/lib/supabaseDb";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const walletAddress =
      typeof body?.walletAddress === "string" ? body.walletAddress.trim() : "";

    if (!walletAddress) {
      return NextResponse.json(
        { error: "Missing walletAddress" },
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

    const saved = await syncCreatorExactStatsInDb(onChainCreator);
    invalidateCreatorCache(onChainCreator.username);

    return NextResponse.json({
      registered: true,
      creator: saved || onChainCreator,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to register creator in Supabase" },
      { status: 500 }
    );
  }
}

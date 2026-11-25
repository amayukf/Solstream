import { NextResponse } from "next/server";
import {
  fetchVerifiedTransactionTip,
  pushVerifiedTipToMemory,
  fetchOnChainCreatorByUsername,
} from "@/lib/solanaServer";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";

    if (!signature || !username) {
      return NextResponse.json(
        { error: "Missing signature or username" },
        { status: 400 }
      );
    }

    // Zero-trust on-chain verification: fetch tx from Devnet RPC and decode TipEvent
    const tip = await fetchVerifiedTransactionTip(signature);
    if (!tip) {
      return NextResponse.json(
        { error: "Transaction not confirmed or did not emit a valid TipEvent" },
        { status: 400 }
      );
    }

    // Ensure the tip recipient matches this creator's authority on-chain
    const creator = await fetchOnChainCreatorByUsername(username);
    if (creator && creator.authority !== tip.creator) {
      return NextResponse.json(
        { error: "Tip recipient does not match creator authority" },
        { status: 400 }
      );
    }

    pushVerifiedTipToMemory(username, tip);

    return NextResponse.json({
      verified: true,
      tip,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to verify on-chain tip" },
      { status: 500 }
    );
  }
}

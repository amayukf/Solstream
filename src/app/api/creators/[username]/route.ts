import { NextResponse } from "next/server";
import {
  fetchOnChainCreatorByUsername,
  fetchRecentTipsForCreator,
} from "@/lib/solanaServer";

export async function GET(
  req: Request,
  context: { params: { username: string } }
) {
  try {
    const username = context.params.username.toLowerCase();
    const { searchParams } = new URL(req.url);
    const fresh = searchParams.get("fresh") === "1";

    const creator = await fetchOnChainCreatorByUsername(username, fresh);
    if (!creator) {
      return NextResponse.json(
        { creator: null, tips: [], found: false },
        { status: 404 }
      );
    }

    const tips = await fetchRecentTipsForCreator(username, creator.pda, fresh);

    return NextResponse.json({
      found: true,
      creator,
      tips,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to look up creator on Solana Devnet" },
      { status: 500 }
    );
  }
}

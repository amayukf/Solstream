import { NextResponse } from "next/server";
import { fetchAllOnChainCreators } from "@/lib/solanaServer";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const fresh = searchParams.get("fresh") === "1";
    const creators = await fetchAllOnChainCreators(fresh);
    return NextResponse.json({ creators });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch on-chain creators" },
      { status: 500 }
    );
  }
}

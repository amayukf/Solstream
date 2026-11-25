import { NextResponse } from "next/server";
import { fetchAllOnChainCreators } from "@/lib/solanaServer";
import {
  getCreatorsFromDb,
  syncCreatorExactStatsInDb,
} from "@/lib/supabaseDb";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const fresh = searchParams.get("fresh") === "1";

    let dbCreators = await getCreatorsFromDb();

    // Sync from Solana Devnet if DB is empty or fresh sync requested
    if (dbCreators.length === 0 || fresh) {
      const chainCreators = await fetchAllOnChainCreators(fresh);
      for (const c of chainCreators) {
        await syncCreatorExactStatsInDb(c);
      }
      dbCreators = await getCreatorsFromDb();
      if (dbCreators.length === 0) {
        return NextResponse.json({ creators: chainCreators, source: "solana" });
      }
    }

    return NextResponse.json({ creators: dbCreators, source: "supabase" });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch creators" },
      { status: 500 }
    );
  }
}

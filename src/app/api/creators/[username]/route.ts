import { NextResponse } from "next/server";
import {
  fetchOnChainCreatorByUsername,
  fetchRecentTipsForCreator,
} from "@/lib/solanaServer";
import {
  getCreatorFromDb,
  getTipsFromDb,
  syncCreatorExactStatsInDb,
  insertTipInDb,
} from "@/lib/supabaseDb";

export async function GET(
  req: Request,
  context: { params: { username: string } }
) {
  try {
    const username = context.params.username.toLowerCase();
    const { searchParams } = new URL(req.url);
    const fresh = searchParams.get("fresh") === "1";

    let dbCreator = await getCreatorFromDb(username);

    // Sync from Solana Devnet if creator isn't cached in Supabase yet or ?fresh=1
    if (!dbCreator || fresh) {
      const chainCreator = await fetchOnChainCreatorByUsername(username, fresh);
      if (!chainCreator) {
        if (!dbCreator) {
          return NextResponse.json(
            { creator: null, tips: [], found: false },
            { status: 404 }
          );
        }
      } else {
        dbCreator = (await syncCreatorExactStatsInDb(chainCreator)) || {
          ...chainCreator,
          id: "",
        };
      }
    }

    if (!dbCreator) {
      return NextResponse.json(
        { creator: null, tips: [], found: false },
        { status: 404 }
      );
    }

    let dbTips = await getTipsFromDb(username);

    // Backfill historical on-chain tips into Supabase if DB has none yet or ?fresh=1
    if ((dbTips.length === 0 || fresh) && dbCreator.pda) {
      const chainTips = await fetchRecentTipsForCreator(
        username,
        dbCreator.pda,
        fresh
      );
      if (dbCreator.id) {
        for (const t of chainTips) {
          await insertTipInDb(dbCreator.id, username, t, null);
        }
        // Re-sync exact on-chain totals so historical backfill doesn't double-count goal_current_lamports
        const exactCreator = await fetchOnChainCreatorByUsername(username, false);
        if (exactCreator) {
          await syncCreatorExactStatsInDb(exactCreator);
          dbCreator = (await getCreatorFromDb(username)) || dbCreator;
        }
        dbTips = await getTipsFromDb(username);
      }
      if (dbTips.length === 0) {
        dbTips = chainTips;
      }
    }

    return NextResponse.json({
      found: true,
      source: "supabase",
      creator: dbCreator,
      tips: dbTips,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to look up creator" },
      { status: 500 }
    );
  }
}

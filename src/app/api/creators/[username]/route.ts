import { NextResponse } from "next/server";
import {
  fetchOnChainCreatorByUsername,
  fetchOnChainCreatorByWallet,
  fetchRecentTipsForCreator,
  type OnChainCreator,
  type OnChainTip,
} from "@/lib/solanaServer";
import {
  getCreatorFromDb,
  getTipsFromDb,
  getTopDonorsFromDb,
  syncCreatorExactStatsInDb,
  insertTipInDb,
  isPostgresUniqueViolation,
  normalizeAudioUrl,
  type DbCreatorRow,
  type DbLeaderboardEntry,
} from "@/lib/supabaseDb";
import {
  checkRateLimit,
  getClientIp,
  rateLimitJsonResponse,
} from "@/lib/rateLimit";

function mergeTipArrays(a: OnChainTip[], b: OnChainTip[]): OnChainTip[] {
  const map = new Map<string, OnChainTip>();
  for (const item of [...a, ...b]) {
    if (!item?.signature) continue;
    const prev = map.get(item.signature);
    if (!prev) {
      map.set(item.signature, {
        ...item,
        audioUrl: normalizeAudioUrl(item.audioUrl),
      });
    } else {
      map.set(item.signature, {
        ...prev,
        ...item,
        audioUrl: normalizeAudioUrl(prev.audioUrl || item.audioUrl),
      });
    }
  }
  return Array.from(map.values()).sort((x, y) => y.timestamp - x.timestamp);
}

export async function GET(
  req: Request,
  context: { params: { username: string } }
) {
  try {
    const username = context.params.username.trim().toLowerCase();
    const { searchParams } = new URL(req.url);
    const fresh = searchParams.get("fresh") === "1";

    if (fresh) {
      const rl = checkRateLimit("creators_fresh", getClientIp(req), 10, 60_000);
      if (!rl.allowed) {
        return rateLimitJsonResponse(rl.retryAfterSeconds);
      }
    }

    let dbCreator: DbCreatorRow | null = null;
    let dbHealthy = false;
    try {
      dbCreator = await getCreatorFromDb(username);
      dbHealthy = true;
    } catch (err) {
      console.warn(`GET /api/creators/${username} DB read warning:`, err);
    }
    const prevDbTotalTips = dbCreator?.totalTips ?? 0;

    // Always fetch on-chain CreatorAccount even when a DB row exists
    let chainCreator: OnChainCreator | null = null;
    let chainHealthy = false;
    try {
      if (dbCreator?.authority) {
        const byWallet = await fetchOnChainCreatorByWallet(dbCreator.authority);
        if (byWallet && byWallet.username === username) {
          chainCreator = byWallet;
        }
      }
      if (!chainCreator) {
        chainCreator = await fetchOnChainCreatorByUsername(username, fresh);
      }
      chainHealthy = true;
    } catch (err) {
      console.warn(`GET /api/creators/${username} Solana read warning:`, err);
    }

    if (!dbHealthy && !chainHealthy) {
      return NextResponse.json(
        { error: "Failed to look up creator" },
        { status: 500 }
      );
    }

    if (chainCreator && dbHealthy) {
      try {
        const synced = await syncCreatorExactStatsInDb(chainCreator);
        if (synced) dbCreator = synced;
      } catch (err) {
        if (isPostgresUniqueViolation(err)) {
          console.warn(
            `Sync skipped for duplicate handle "${chainCreator.username}" (${chainCreator.authority})`
          );
        } else {
          console.warn(`Creator DB sync warning for @${username}:`, err);
        }
      }
    }

    const resolvedCreator = chainCreator
      ? { ...(dbCreator || {}), ...chainCreator, id: dbCreator?.id || "" }
      : dbCreator;

    if (!resolvedCreator) {
      return NextResponse.json(
        { creator: null, tips: [], found: false },
        { status: 404 }
      );
    }

    let dbTips: OnChainTip[] = [];
    if (dbHealthy) {
      try {
        dbTips = await getTipsFromDb(username);
      } catch (err) {
        console.warn(`GET /api/creators/${username} tips DB warning:`, err);
        dbHealthy = false;
      }
    }

    const chainAheadOfDb = Boolean(
      chainCreator &&
        (chainCreator.totalTips > prevDbTotalTips ||
          (chainCreator.totalTips > dbTips.length && dbTips.length < 50))
    );

    let chainTips: OnChainTip[] = [];
    if (
      (fresh || !dbHealthy || dbTips.length === 0 || chainAheadOfDb) &&
      resolvedCreator.pda
    ) {
      try {
        chainTips = await fetchRecentTipsForCreator(
          username,
          resolvedCreator.pda,
          fresh || chainAheadOfDb
        );
      } catch (err) {
        console.warn(
          `GET /api/creators/${username} on-chain tips warning:`,
          err
        );
      }

      if (dbHealthy && resolvedCreator.id && chainTips.length > 0) {
        const seenInDb = new Set(dbTips.map((t) => t.signature));
        for (const t of chainTips) {
          if (seenInDb.has(t.signature)) continue;
          try {
            await insertTipInDb(resolvedCreator.id, username, t, null);
          } catch (err) {
            console.warn(`Historical tip backfill warning for @${username}:`, err);
          }
        }
        if (chainCreator) {
          try {
            await syncCreatorExactStatsInDb(chainCreator);
          } catch (err) {
            console.warn(`Creator post-backfill sync warning:`, err);
          }
        }
        try {
          dbTips = await getTipsFromDb(username);
        } catch (err) {
          console.warn(`Tips DB refresh warning for @${username}:`, err);
        }
      }
    }

    const mergedTips = mergeTipArrays(dbTips, chainTips);
    let leaderboard: DbLeaderboardEntry[] | null = null;
    if (dbHealthy && resolvedCreator.id) {
      try {
        leaderboard = await getTopDonorsFromDb(resolvedCreator.id);
      } catch (err) {
        console.warn(`GET /api/creators/${username} leaderboard warning:`, err);
        leaderboard = null;
      }
    }

    const source = !dbHealthy
      ? "solana"
      : chainCreator
      ? "solana+supabase"
      : "supabase";

    return NextResponse.json({
      found: true,
      source,
      creator: resolvedCreator,
      tips: mergedTips,
      leaderboard,
    });
  } catch (err) {
    console.error("GET /api/creators/[username] error:", err);
    return NextResponse.json(
      { error: "Failed to look up creator" },
      { status: 500 }
    );
  }
}

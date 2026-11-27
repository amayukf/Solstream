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
  getExistingTipSignaturesInDb,
  getTopDonorsFromDb,
  getPollWithResultsFromDb,
  syncCreatorExactStatsInDb,
  insertTipInDb,
  isPostgresUniqueViolation,
  normalizeAudioUrl,
  type DbCreatorRow,
  type DbLeaderboardEntry,
  type CreatorPollState,
} from "@/lib/supabaseDb";
import {
  checkRateLimit,
  getClientIp,
  rateLimitJsonResponse,
} from "@/lib/rateLimit";

function needsCreatorDbSync(
  db: DbCreatorRow | null,
  chain: OnChainCreator
): boolean {
  if (!db) return true;
  return (
    db.authority !== chain.authority ||
    db.pda !== chain.pda ||
    db.voiceId !== chain.voiceId ||
    db.goalTitle !== chain.goalTitle ||
    db.goalTargetLamports !== chain.goalTargetLamports ||
    db.goalCurrentLamports !== chain.goalCurrentLamports ||
    db.totalTips !== chain.totalTips ||
    db.totalVolume !== chain.totalVolume
  );
}

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
  context: { params: Promise<{ username: string }> }
) {
  try {
    const { username: rawUsername } = await context.params;
    const username = rawUsername.trim().toLowerCase();
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

    if (chainCreator && dbHealthy && needsCreatorDbSync(dbCreator, chainCreator)) {
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
      if (!chainHealthy) {
        return NextResponse.json(
          { error: "Solana RPC temporarily unavailable" },
          { status: 503 }
        );
      }
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
          fresh || chainAheadOfDb,
          undefined,
          resolvedCreator.authority
        );
      } catch (err) {
        console.warn(
          `GET /api/creators/${username} on-chain tips warning:`,
          err
        );
      }

      if (dbHealthy && resolvedCreator.id && chainTips.length > 0) {
        let insertedCount = 0;
        let existingSigs: Set<string>;
        try {
          existingSigs = await getExistingTipSignaturesInDb(
            chainTips.map((t) => t.signature)
          );
        } catch {
          existingSigs = new Set(dbTips.map((t) => t.signature));
        }

        for (const t of chainTips) {
          if (existingSigs.has(t.signature)) continue;
          try {
            const res = await insertTipInDb(
              resolvedCreator.id,
              username,
              t,
              null
            );
            if (res.inserted) insertedCount += 1;
          } catch (err) {
            console.warn(`Historical tip backfill warning for @${username}:`, err);
          }
        }
        if (
          chainCreator &&
          (insertedCount > 0 || needsCreatorDbSync(dbCreator, chainCreator))
        ) {
          try {
            const synced = await syncCreatorExactStatsInDb(chainCreator);
            if (synced) dbCreator = synced;
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
    let poll: CreatorPollState | null = null;
    if (dbHealthy) {
      if (resolvedCreator.id) {
        try {
          leaderboard = await getTopDonorsFromDb(resolvedCreator.id);
        } catch (err) {
          console.warn(`GET /api/creators/${username} leaderboard warning:`, err);
          leaderboard = null;
        }
      }
      try {
        poll = await getPollWithResultsFromDb(username);
      } catch (err) {
        console.warn(`GET /api/creators/${username} poll warning:`, err);
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
      poll,
    });
  } catch (err) {
    console.error("GET /api/creators/[username] error:", err);
    return NextResponse.json(
      { error: "Failed to look up creator" },
      { status: 500 }
    );
  }
}

import "./setup";
import { expect } from "chai";
import { isReservedHandle } from "../../src/lib/constants";
import * as solanaServer from "../../src/lib/solanaServer";
import * as supabaseDb from "../../src/lib/supabaseDb";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

describe("Creators API & Reserved Handle Guards", () => {
  const creatorRoutePath = require.resolve("../../src/app/api/creators/[username]/route");
  const solanaServerPath = require.resolve("../../src/lib/solanaServer");
  const supabaseDbPath = require.resolve("../../src/lib/supabaseDb");

  afterEach(() => {
    delete require.cache[creatorRoutePath];
  });

  it("blocks reserved Next.js route and system handles", () => {
    expect(isReservedHandle("claim")).to.equal(true);
    expect(isReservedHandle("DASHBOARD")).to.equal(true);
    expect(isReservedHandle("overlay")).to.equal(true);
    expect(isReservedHandle("actions.json")).to.equal(true);
    expect(isReservedHandle("amayukaba")).to.equal(false);
  });

  it("resyncs exact on-chain creator stats after backfilling missed tips to prevent DB counter double-counting", async () => {
    const origSolana = require.cache[solanaServerPath]?.exports;
    const origDb = require.cache[supabaseDbPath]?.exports;

    const authority = "AuthWallet11111111111111111111111111111111";
    const pda = "CreatorPda111111111111111111111111111111111";

    const chainCreator: solanaServer.OnChainCreator = {
      pda,
      authority,
      username: "kaba",
      voiceId: "pNInz6obpgDQGcFmaJgB",
      goalTitle: "Mic",
      goalTargetLamports: 1_000_000_000,
      goalCurrentLamports: 25_000_000,
      totalTips: 2,
      totalVolume: 25_000_000,
      bump: 255,
    };

    // Start DB row already synced with chainCreator before tip backfill
    let currentDbRow: supabaseDb.DbCreatorRow = {
      id: "uuid-kaba",
      ...chainCreator,
    };
    const dbTips: solanaServer.OnChainTip[] = [];
    let syncExactCalls = 0;
    let checkedExistingSigs = false;

    const missedTip: solanaServer.OnChainTip = {
      signature: "MissedBackfillSig111111111111111111111111111",
      creator: authority,
      donor: "DonorWallet1111111111111111111111111111111",
      amountLamports: 10_000_000,
      tier: 1,
      displayName: "BackfilledFan",
      message: "Late sync",
      timestamp: 1_750_000_000_000,
    };

    try {
      (require.cache[solanaServerPath] as Mutable<NodeModule>).exports = {
        ...solanaServer,
        fetchOnChainCreatorByWallet: async () => chainCreator,
        fetchOnChainCreatorByUsername: async () => chainCreator,
        fetchRecentTipsForCreator: async () => [missedTip],
      };

      (require.cache[supabaseDbPath] as Mutable<NodeModule>).exports = {
        ...supabaseDb,
        getCreatorFromDb: async () => currentDbRow,
        getTipsFromDb: async () => [...dbTips],
        getExistingTipSignaturesInDb: async (sigs: string[]) => {
          checkedExistingSigs = true;
          return new Set(
            sigs.filter((s) => dbTips.some((existing) => existing.signature === s))
          );
        },
        insertTipInDb: async (_cId: string, _u: string, tip: solanaServer.OnChainTip) => {
          // Simulate Postgres trigger/UPDATE incrementing counters beyond chain total!
          currentDbRow = {
            ...currentDbRow,
            totalTips: currentDbRow.totalTips + 1,
            totalVolume: currentDbRow.totalVolume + tip.amountLamports,
            goalCurrentLamports:
              currentDbRow.goalCurrentLamports + tip.amountLamports,
          };
          dbTips.push(tip);
          return { inserted: true, row: tip };
        },
        syncCreatorExactStatsInDb: async (chain: solanaServer.OnChainCreator) => {
          syncExactCalls += 1;
          currentDbRow = { ...currentDbRow, ...chain };
          return currentDbRow;
        },
        getTopDonorsFromDb: async () => [],
        getPollWithResultsFromDb: async () => null,
      };

      delete require.cache[creatorRoutePath];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const route = require("../../src/app/api/creators/[username]/route") as {
        GET: (
          req: Request,
          ctx: { params: Promise<{ username: string }> }
        ) => Promise<Response>;
      };

      const res = await route.GET(
        new Request("https://solstream.app/api/creators/kaba"),
        { params: Promise.resolve({ username: "kaba" }) }
      );
      expect(res.status).to.equal(200);
      expect(checkedExistingSigs).to.equal(true);
      expect(syncExactCalls).to.equal(1);
      expect(currentDbRow.totalTips).to.equal(2);
      expect(currentDbRow.totalVolume).to.equal(25_000_000);
    } finally {
      if (origSolana) {
        (require.cache[solanaServerPath] as Mutable<NodeModule>).exports = origSolana;
      }
      if (origDb) {
        (require.cache[supabaseDbPath] as Mutable<NodeModule>).exports = origDb;
      }
    }
  });
});

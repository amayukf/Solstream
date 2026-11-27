import "./setup";
import { expect } from "chai";
import type { OnChainCreator, OnChainTip } from "../../src/lib/solanaServer";
import type { DbCreatorRow } from "../../src/lib/supabaseDb";
import {
  sanitizeForTts,
  verifyAndProcessTip,
  type TipProcessorDeps,
} from "../../src/lib/tipProcessor";

function makeCreator(overrides: Partial<DbCreatorRow> = {}): DbCreatorRow {
  return {
    id: "uuid-creator-1",
    pda: "CreatorPda111111111111111111111111111111111",
    authority: "AuthWallet11111111111111111111111111111111",
    username: "streamer",
    voiceId: "pNInz6obpgDQGcFmaJgB",
    goalTitle: "Mic upgrade",
    goalTargetLamports: 3_000_000_000,
    goalCurrentLamports: 0,
    totalTips: 0,
    totalVolume: 0,
    bump: 255,
    ...overrides,
  };
}

function makeTip(overrides: Partial<OnChainTip> = {}): OnChainTip {
  return {
    signature: "SigBase58Valid11111111111111111111111111111",
    creator: "AuthWallet11111111111111111111111111111111",
    donor: "DonorWallet1111111111111111111111111111111",
    amountLamports: 5_000_000,
    tier: 0,
    displayName: "FanOne",
    message: "[VOTE:A] Let's go!",
    timestamp: 1_750_000_000_000,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<TipProcessorDeps> = {}): TipProcessorDeps {
  const creator = makeCreator();
  const chainCreator: OnChainCreator = { ...creator };
  return {
    ensureDbReady: async () => true,
    getCreatorFromDb: async () => creator,
    fetchOnChainCreatorByUsername: async () => chainCreator,
    upsertCreatorInDb: async () => creator,
    fetchVerifiedTransactionTip: async () => makeTip(),
    hasTipSignatureInDb: async () => false,
    insertTipInDb: async (_cId, _u, tip) => ({ inserted: true, row: tip }),
    uploadAlertAudioToStorage: async () =>
      "https://example.supabase.co/storage/v1/object/public/stream-alerts/streamer/sig.mp3",
    generateTtsBuffer: async () => Buffer.from("mp3-bytes"),
    isSignatureProcessed: () => false,
    markSignatureProcessed: () => {},
    pushVerifiedTipToMemory: () => {},
    ...overrides,
  };
}

describe("tipProcessor (verifyAndProcessTip)", () => {
  it("strips [VOTE:X] tags from TTS speech script", () => {
    expect(sanitizeForTts("[VOTE:B] Play ranked next!")).to.equal(
      "Play ranked next!"
    );
  });

  it("rejects reserved platform handles with 400", async () => {
    const res = await verifyAndProcessTip("sig123", "dashboard", makeDeps());
    expect(res.status).to.equal(400);
  });

  it("fails closed with 503 when Postgres is unavailable", async () => {
    let ttsCalled = false;
    const res = await verifyAndProcessTip(
      "sig-db-down",
      "streamer",
      makeDeps({
        ensureDbReady: async () => false,
        generateTtsBuffer: async () => {
          ttsCalled = true;
          return Buffer.from("x");
        },
      })
    );
    expect(res.status).to.equal(503);
    expect(ttsCalled).to.equal(false);
  });

  it("returns 404 when creator exists neither in DB nor on-chain", async () => {
    const res = await verifyAndProcessTip(
      "sig-missing-creator",
      "nobody",
      makeDeps({
        getCreatorFromDb: async () => null,
        fetchOnChainCreatorByUsername: async () => null,
      })
    );
    expect(res.status).to.equal(404);
  });

  it("returns 409 when DB creator authority conflicts with on-chain authority", async () => {
    const res = await verifyAndProcessTip(
      "sig-mismatch",
      "streamer",
      makeDeps({
        getCreatorFromDb: async () =>
          makeCreator({ authority: "DbWalletDifferent1111111111111111111111111" }),
      })
    );
    expect(res.status).to.equal(409);
  });

  it("returns 503 instead of 400/404 when Solana RPC fails during lookup or tx fetch", async () => {
    const creatorErr = await verifyAndProcessTip(
      "sig-rpc-1",
      "streamer",
      makeDeps({
        fetchOnChainCreatorByUsername: async () => {
          throw new Error("RPC timeout");
        },
      })
    );
    expect(creatorErr.status).to.equal(503);

    const txErr = await verifyAndProcessTip(
      "sig-rpc-2",
      "streamer",
      makeDeps({
        fetchVerifiedTransactionTip: async () => {
          throw new Error("getTransaction 503");
        },
      })
    );
    expect(txErr.status).to.equal(503);
  });

  it("coalesces concurrent verify requests for the same signature without duplicating TTS or DB writes", async () => {
    let ttsCount = 0;
    let insertCount = 0;
    let pushedCount = 0;
    const processed = new Set<string>();

    const deps = makeDeps({
      generateTtsBuffer: async (_voiceId, speechScript) => {
        ttsCount += 1;
        expect(speechScript).to.not.include("[VOTE:A]");
        await new Promise((r) => setTimeout(r, 25));
        return Buffer.from("audio");
      },
      insertTipInDb: async (_cId, _u, tip) => {
        insertCount += 1;
        return { inserted: true, row: tip };
      },
      isSignatureProcessed: (sig) => processed.has(sig),
      markSignatureProcessed: (sig) => {
        processed.add(sig);
      },
      pushVerifiedTipToMemory: () => {
        pushedCount += 1;
      },
    });

    const sig = `ConcurrentSig_${Date.now()}`;
    const [first, second] = await Promise.all([
      verifyAndProcessTip(sig, "streamer", deps, { coalesce: true }),
      verifyAndProcessTip(sig, "streamer", deps, { coalesce: true }),
    ]);

    expect(first.status).to.equal(200);
    expect(second.status).to.equal(200);
    expect(ttsCount).to.equal(1);
    expect(insertCount).to.equal(1);
    expect(pushedCount).to.equal(1);
    expect((second.body as { alreadyProcessed?: boolean }).alreadyProcessed).to.equal(
      true
    );

    const third = await verifyAndProcessTip(sig, "streamer", deps, {
      coalesce: true,
    });
    expect(third.status).to.equal(200);
    expect((third.body as { alreadyProcessed?: boolean }).alreadyProcessed).to.equal(
      true
    );
    expect(ttsCount).to.equal(1);
  });
});

import "./setup";
import crypto from "crypto";
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import * as solanaServer from "../../src/lib/solanaServer";
import * as supabaseDb from "../../src/lib/supabaseDb";
import {
  buildPollSignPayload,
  classifyPollVote,
  stripVoteTagForSpeech,
  type CreatorPollState,
} from "../../src/lib/polls";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function generateEd25519Signer() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const walletAddress = new PublicKey(spki.subarray(-32)).toBase58();
  return {
    walletAddress,
    sign: (message: string): string =>
      crypto.sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64"),
  };
}

describe("Live Micro-Vote Polls helpers & POST /api/polls/[username]", () => {
  const pollsRoutePath = require.resolve("../../src/app/api/polls/[username]/route");
  const solanaServerPath = require.resolve("../../src/lib/solanaServer");
  const supabaseDbPath = require.resolve("../../src/lib/supabaseDb");

  afterEach(() => {
    delete require.cache[pollsRoutePath];
  });

  it("classifies vote tags and strips tags for speech", () => {
    expect(classifyPollVote("[VOTE:A] Go next!")).to.equal("A");
    expect(classifyPollVote("Count me in #b please")).to.equal("B");
    expect(classifyPollVote("Just a tip")).to.equal(null);
    expect(stripVoteTagForSpeech("  [VOTE:A]  Switch map! ")).to.equal(
      "Switch map!"
    );
  });

  it("verifies full signed payload, rejects tampering & replay nonces, and surfaces MissingPollsTableError as 503", async () => {
    const origSolana = require.cache[solanaServerPath]?.exports;
    const origDb = require.cache[supabaseDbPath]?.exports;

    const signer = generateEd25519Signer();
    const attacker = generateEd25519Signer();
    let throwMissingTable = false;

    const savedState: CreatorPollState = {
      username: "kaba",
      question: "Next boss?",
      optionA: "Malenia",
      optionB: "Radahn",
      minVoteLamports: 5_000_000,
      isActive: true,
      startedAt: Date.now(),
      votesA: 0,
      votesB: 0,
      lamportsA: 0,
      lamportsB: 0,
    };

    try {
      (require.cache[solanaServerPath] as Mutable<NodeModule>).exports = {
        ...solanaServer,
        fetchOnChainCreatorByUsername: async () => ({
          pda: "CreatorPda111111111111111111111111111111111",
          authority: signer.walletAddress,
          username: "kaba",
          voiceId: "pNInz6obpgDQGcFmaJgB",
          goalTitle: "Mic",
          goalTargetLamports: 1_000_000_000,
          goalCurrentLamports: 0,
          totalTips: 0,
          totalVolume: 0,
          bump: 255,
        }),
      };

      (require.cache[supabaseDbPath] as Mutable<NodeModule>).exports = {
        ...supabaseDb,
        ensureDbReady: async () => true,
        getCreatorFromDb: async () => ({
          id: "uuid-kaba",
          pda: "CreatorPda111111111111111111111111111111111",
          authority: signer.walletAddress,
          username: "kaba",
          voiceId: "pNInz6obpgDQGcFmaJgB",
          goalTitle: "Mic",
          goalTargetLamports: 1_000_000_000,
          goalCurrentLamports: 0,
          totalTips: 0,
          totalVolume: 0,
          bump: 255,
        }),
        getPollWithResultsFromDb: async () => savedState,
        upsertCreatorPollInDb: async (input: {
          question: string;
          optionA: string;
          optionB: string;
          minVoteLamports: number;
          isActive: boolean;
        }) => {
          if (throwMissingTable) {
            throw new supabaseDb.MissingPollsTableError();
          }
          return {
            ...savedState,
            ...input,
          };
        },
      };

      delete require.cache[pollsRoutePath];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const route = require("../../src/app/api/polls/[username]/route") as {
        POST: (
          req: Request,
          ctx: { params: Promise<{ username: string }> }
        ) => Promise<Response>;
      };

      const timestampMs = Date.now();
      const nonce = `nonce-${timestampMs}-valid`;
      const payload = buildPollSignPayload({
        username: "kaba",
        action: "upsert",
        question: "Next boss?",
        optionA: "Malenia",
        optionB: "Radahn",
        minVoteSol: 0.005,
        timestampMs,
        nonce,
      });

      const tamperedRes = await route.POST(
        new Request("https://solstream.app/api/polls/kaba", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-real-ip": "203.0.113.10",
          },
          body: JSON.stringify({
            walletAddress: signer.walletAddress,
            signedMessage: payload,
            signature: signer.sign(payload),
            timestampMs,
            nonce,
            action: "upsert",
            question: "Tampered question?",
            optionA: "Malenia",
            optionB: "Radahn",
            minVoteSol: 0.005,
          }),
        }),
        { params: Promise.resolve({ username: "kaba" }) }
      );
      expect(tamperedRes.status).to.equal(401);

      const wrongSigRes = await route.POST(
        new Request("https://solstream.app/api/polls/kaba", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-real-ip": "203.0.113.11",
          },
          body: JSON.stringify({
            walletAddress: signer.walletAddress,
            signedMessage: payload,
            signature: attacker.sign(payload),
            timestampMs,
            nonce,
            action: "upsert",
            question: "Next boss?",
            optionA: "Malenia",
            optionB: "Radahn",
            minVoteSol: 0.005,
          }),
        }),
        { params: Promise.resolve({ username: "kaba" }) }
      );
      expect(wrongSigRes.status).to.equal(401);

      const validReqBody = JSON.stringify({
        walletAddress: signer.walletAddress,
        signedMessage: payload,
        signature: signer.sign(payload),
        timestampMs,
        nonce,
        action: "upsert",
        question: "Next boss?",
        optionA: "Malenia",
        optionB: "Radahn",
        minVoteSol: 0.005,
      });

      const okRes = await route.POST(
        new Request("https://solstream.app/api/polls/kaba", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-real-ip": "203.0.113.12",
          },
          body: validReqBody,
        }),
        { params: Promise.resolve({ username: "kaba" }) }
      );
      expect(okRes.status).to.equal(200);
      const okData = (await okRes.json()) as { poll: CreatorPollState };
      expect(okData.poll.question).to.equal("Next boss?");
      expect(okData.poll.isActive).to.equal(true);

      const replayRes = await route.POST(
        new Request("https://solstream.app/api/polls/kaba", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-real-ip": "203.0.113.13",
          },
          body: validReqBody,
        }),
        { params: Promise.resolve({ username: "kaba" }) }
      );
      expect(replayRes.status).to.equal(409);

      throwMissingTable = true;
      const nonce2 = `nonce-${timestampMs}-503`;
      const payload2 = buildPollSignPayload({
        username: "kaba",
        action: "upsert",
        question: "Next boss?",
        optionA: "Malenia",
        optionB: "Radahn",
        minVoteSol: 0.005,
        timestampMs,
        nonce: nonce2,
      });
      const tableErrRes = await route.POST(
        new Request("https://solstream.app/api/polls/kaba", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-real-ip": "203.0.113.14",
          },
          body: JSON.stringify({
            walletAddress: signer.walletAddress,
            signedMessage: payload2,
            signature: signer.sign(payload2),
            timestampMs,
            nonce: nonce2,
            action: "upsert",
            question: "Next boss?",
            optionA: "Malenia",
            optionB: "Radahn",
            minVoteSol: 0.005,
          }),
        }),
        { params: Promise.resolve({ username: "kaba" }) }
      );
      expect(tableErrRes.status).to.equal(503);
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

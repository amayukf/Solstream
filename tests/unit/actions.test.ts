import "./setup";
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import * as solanaServer from "../../src/lib/solanaServer";
import * as supabaseDb from "../../src/lib/supabaseDb";
import { GET as getActionsJson, OPTIONS as optionsActionsJson } from "../../src/app/actions.json/route";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

describe("Solana Actions / Blinks routes", () => {
  const actionsRoutePath = require.resolve("../../src/app/api/actions/tip/[username]/route");
  const solanaServerPath = require.resolve("../../src/lib/solanaServer");
  const supabaseDbPath = require.resolve("../../src/lib/supabaseDb");

  afterEach(() => {
    delete require.cache[actionsRoutePath];
  });

  it("advertises /tip/* and /api/actions/** rules without a root /* wildcard in /actions.json", async () => {
    const res = await getActionsJson();
    expect(res.status).to.equal(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).to.equal("*");

    const data = (await res.json()) as {
      rules: Array<{ pathPattern: string; apiPath: string }>;
    };
    expect(data.rules).to.deep.equal([
      { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
      { pathPattern: "/tip/*", apiPath: "/api/actions/tip/*" },
    ]);
    expect(data.rules.some((r) => r.pathPattern === "/*")).to.equal(false);

    const optRes = await optionsActionsJson();
    expect(optRes.status).to.equal(204);
  });

  it("forwards validated ref query parameter across all GET Blink action links and rejects reserved handles", async () => {
    const origSolana = require.cache[solanaServerPath]?.exports;
    const origDb = require.cache[supabaseDbPath]?.exports;
    let builtWithRef: string | undefined;

    const authority = Keypair.generate().publicKey.toBase58();
    const pda = Keypair.generate().publicKey.toBase58();
    const donor = Keypair.generate().publicKey.toBase58();
    const refKey = Keypair.generate().publicKey.toBase58();

    const mockCreator: solanaServer.OnChainCreator = {
      pda,
      authority,
      username: "kaba",
      voiceId: "pNInz6obpgDQGcFmaJgB",
      goalTitle: "Studio Mic",
      goalTargetLamports: 2_000_000_000,
      goalCurrentLamports: 500_000_000,
      totalTips: 3,
      totalVolume: 500_000_000,
      bump: 255,
    };

    try {
      (require.cache[solanaServerPath] as Mutable<NodeModule>).exports = {
        ...solanaServer,
        fetchOnChainCreatorByUsername: async () => mockCreator,
        buildSerializedSendTipTransaction: async (params: {
          referenceKey?: string;
        }) => {
          builtWithRef = params.referenceKey;
          return "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
        },
      };

      (require.cache[supabaseDbPath] as Mutable<NodeModule>).exports = {
        ...supabaseDb,
        getCreatorFromDb: async () => ({ id: "uuid-1", ...mockCreator }),
        getPollWithResultsFromDb: async () => ({
          username: "kaba",
          question: "Next game?",
          optionA: "Valorant",
          optionB: "CS2",
          minVoteLamports: 5_000_000,
          isActive: true,
          startedAt: Date.now(),
          votesA: 1,
          votesB: 2,
          lamportsA: 5_000_000,
          lamportsB: 10_000_000,
        }),
      };

      delete require.cache[actionsRoutePath];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const route = require("../../src/app/api/actions/tip/[username]/route") as {
        GET: (
          req: Request,
          ctx: { params: Promise<{ username: string }> }
        ) => Promise<Response>;
        POST: (
          req: Request,
          ctx: { params: Promise<{ username: string }> }
        ) => Promise<Response>;
      };

      const reservedRes = await route.GET(
        new Request("https://solstream.app/api/actions/tip/dashboard"),
        { params: Promise.resolve({ username: "dashboard" }) }
      );
      expect(reservedRes.status).to.equal(404);

      const badRefRes = await route.GET(
        new Request("https://solstream.app/api/actions/tip/kaba?ref=not-a-pubkey"),
        { params: Promise.resolve({ username: "kaba" }) }
      );
      expect(badRefRes.status).to.equal(400);

      const okRes = await route.GET(
        new Request(`https://solstream.app/api/actions/tip/kaba?ref=${refKey}`),
        { params: Promise.resolve({ username: "kaba" }) }
      );
      expect(okRes.status).to.equal(200);
      const body = (await okRes.json()) as {
        links: { actions: Array<{ href: string; label: string }> };
      };
      expect(body.links.actions.length).to.equal(6);
      for (const action of body.links.actions) {
        expect(action.href).to.include(`&ref=${encodeURIComponent(refKey)}`);
      }

      const underMinVoteRes = await route.POST(
        new Request(
          `https://solstream.app/api/actions/tip/kaba?amount=0.001&vote=A&ref=${refKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account: donor }),
          }
        ),
        { params: Promise.resolve({ username: "kaba" }) }
      );
      expect(underMinVoteRes.status).to.equal(400);

      const postRes = await route.POST(
        new Request(
          `https://solstream.app/api/actions/tip/kaba?amount=0.01&vote=A&ref=${refKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account: donor }),
          }
        ),
        { params: Promise.resolve({ username: "kaba" }) }
      );
      expect(postRes.status).to.equal(200);
      expect(builtWithRef).to.equal(refKey);
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

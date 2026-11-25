import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, DEVNET_RPC_URL } from "@/lib/constants";

export interface OnChainCreator {
  pda: string;
  authority: string;
  username: string;
  voiceId: string;
  goalTitle: string;
  goalTargetLamports: number;
  goalCurrentLamports: number;
  totalTips: number;
  totalVolume: number;
  bump: number;
}

export interface OnChainTip {
  signature: string;
  creator: string;
  donor: string;
  amountLamports: number;
  tier: number;
  displayName: string;
  message: string;
  timestamp: number;
  audioDataUrl?: string | null;
}

const CREATOR_DISC = [222, 163, 32, 169, 204, 8, 200, 32];
const TIP_EVENT_DISC = [213, 36, 191, 50, 28, 25, 189, 252];

function hasDiscriminator(buf: Buffer, expected: number[]): boolean {
  if (buf.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== expected[i]) return false;
  }
  return true;
}

export function decodeCreatorAccountBuffer(
  buf: Buffer,
  pda: string
): OnChainCreator | null {
  try {
    if (!hasDiscriminator(buf, CREATOR_DISC) || buf.length < 44) return null;
    let offset = 8;
    const authority = new PublicKey(buf.slice(offset, offset + 32)).toBase58();
    offset += 32;

    const uLen = buf.readUInt32LE(offset);
    offset += 4;
    const username = buf.slice(offset, offset + uLen).toString("utf8");
    offset += uLen;

    const vLen = buf.readUInt32LE(offset);
    offset += 4;
    const voiceId = buf.slice(offset, offset + vLen).toString("utf8");
    offset += vLen;

    const gLen = buf.readUInt32LE(offset);
    offset += 4;
    const goalTitle = buf.slice(offset, offset + gLen).toString("utf8");
    offset += gLen;

    const goalTargetLamports = Number(buf.readBigUInt64LE(offset));
    offset += 8;

    const goalCurrentLamports = Number(buf.readBigUInt64LE(offset));
    offset += 8;

    const totalTips = Number(buf.readBigUInt64LE(offset));
    offset += 8;

    const totalVolume = Number(buf.readBigUInt64LE(offset));
    offset += 8;

    const bump = buf.readUInt8(offset);

    return {
      pda,
      authority,
      username: username.toLowerCase(),
      voiceId,
      goalTitle,
      goalTargetLamports,
      goalCurrentLamports,
      totalTips,
      totalVolume,
      bump,
    };
  } catch {
    return null;
  }
}

export function decodeTipEventFromLogs(
  logs: string[] | undefined | null,
  signature: string,
  fallbackBlockTime?: number | null
): OnChainTip | null {
  if (!logs || logs.length === 0) return null;
  for (const log of logs) {
    if (!log.startsWith("Program data: ")) continue;
    try {
      const b64 = log.slice("Program data: ".length).trim();
      const buf = Buffer.from(b64, "base64");
      if (!hasDiscriminator(buf, TIP_EVENT_DISC)) continue;

      let offset = 8;
      const creator = new PublicKey(buf.slice(offset, offset + 32)).toBase58();
      offset += 32;
      const donor = new PublicKey(buf.slice(offset, offset + 32)).toBase58();
      offset += 32;
      const amountLamports = Number(buf.readBigUInt64LE(offset));
      offset += 8;
      const tier = buf.readUInt8(offset);
      offset += 1;

      const nLen = buf.readUInt32LE(offset);
      offset += 4;
      const displayName = buf.slice(offset, offset + nLen).toString("utf8");
      offset += nLen;

      const mLen = buf.readUInt32LE(offset);
      offset += 4;
      const message = buf.slice(offset, offset + mLen).toString("utf8");
      offset += mLen;

      const rawTs = Number(buf.readBigInt64LE(offset));
      const tsSeconds =
        rawTs || fallbackBlockTime || Math.floor(Date.now() / 1000);

      return {
        signature,
        creator,
        donor,
        amountLamports,
        tier,
        displayName,
        message,
        timestamp: tsSeconds * 1000,
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function rpcCall(
  method: string,
  params: any[],
  retries = 2
): Promise<any> {
  try {
    const res = await fetch(DEVNET_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "RPC error");
    return data.result;
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 1200));
      return rpcCall(method, params, retries - 1);
    }
    throw err;
  }
}

interface GlobalSolStreamStore {
  txBySigCache: Map<string, OnChainTip | null>;
  creatorsCache: { items: OnChainCreator[]; fetchedAt: number } | null;
  inflightCreators: Promise<OnChainCreator[]> | null;
  tipsCache: Map<string, { items: OnChainTip[]; fetchedAt: number }>;
  inflightTips: Map<string, Promise<OnChainTip[]>>;
  verifiedTipsMemory: Map<string, OnChainTip[]>;
}

const globalForSolStream = globalThis as unknown as {
  __solstreamStore?: GlobalSolStreamStore;
};

const store: GlobalSolStreamStore =
  globalForSolStream.__solstreamStore ??
  (globalForSolStream.__solstreamStore = {
    txBySigCache: new Map(),
    creatorsCache: null,
    inflightCreators: null,
    tipsCache: new Map(),
    inflightTips: new Map(),
    verifiedTipsMemory: new Map(),
  });

const txBySigCache = store.txBySigCache;
const tipsCache = store.tipsCache;
const inflightTips = store.inflightTips;
const verifiedTipsMemory = store.verifiedTipsMemory;

export function invalidateCreatorCache(username?: string) {
  store.creatorsCache = null;
  if (username) {
    tipsCache.delete(username.toLowerCase());
  }
}

export function pushVerifiedTipToMemory(username: string, tip: OnChainTip) {
  const key = username.toLowerCase();
  txBySigCache.set(tip.signature, tip);

  const existing = verifiedTipsMemory.get(key) || [];
  const filtered = existing.filter((t) => t.signature !== tip.signature);
  verifiedTipsMemory.set(key, [tip, ...filtered]);
  invalidateCreatorCache(key);
}

export async function fetchAllOnChainCreators(
  forceFresh = false
): Promise<OnChainCreator[]> {
  if (
    !forceFresh &&
    store.creatorsCache &&
    Date.now() - store.creatorsCache.fetchedAt < 15_000
  ) {
    return store.creatorsCache.items;
  }

  if (store.inflightCreators) return store.inflightCreators;

  store.inflightCreators = (async () => {
    try {
      const accounts = await rpcCall("getProgramAccounts", [
        PROGRAM_ID.toBase58(),
        { encoding: "base64", commitment: "confirmed" },
      ]);

      const decoded: OnChainCreator[] = [];
      for (const item of accounts || []) {
        const b64 = item?.account?.data?.[0];
        if (!b64) continue;
        const buf = Buffer.from(b64, "base64");
        const creator = decodeCreatorAccountBuffer(buf, item.pubkey);
        if (creator) decoded.push(creator);
      }

      store.creatorsCache = { items: decoded, fetchedAt: Date.now() };
      return decoded;
    } catch (err) {
      console.warn("fetchAllOnChainCreators RPC warning:", err);
      return store.creatorsCache?.items || [];
    } finally {
      store.inflightCreators = null;
    }
  })();

  return store.inflightCreators;
}

export async function fetchOnChainCreatorByUsername(
  username: string,
  forceFresh = false
): Promise<OnChainCreator | null> {
  const target = username.trim().toLowerCase();
  const all = await fetchAllOnChainCreators(forceFresh);
  return all.find((c) => c.username === target) || null;
}

export async function fetchVerifiedTransactionTip(
  signature: string
): Promise<OnChainTip | null> {
  // Return immediately from immutable signature cache if already verified
  for (const list of Array.from(verifiedTipsMemory.values())) {
    const found = list.find((t) => t.signature === signature);
    if (found) return found;
  }
  const cachedTx = txBySigCache.get(signature);
  if (cachedTx) return cachedTx;

  const tx = await rpcCall("getTransaction", [
    signature,
    {
      encoding: "json",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    },
  ]);

  if (!tx || tx.meta?.err !== null) {
    return null;
  }

  const tip = decodeTipEventFromLogs(
    tx.meta?.logMessages,
    signature,
    tx.blockTime
  );
  if (tip) {
    txBySigCache.set(signature, tip);
  }
  return tip;
}

export async function fetchRecentTipsForCreator(
  username: string,
  pda: string,
  forceFresh = false
): Promise<OnChainTip[]> {
  const key = username.toLowerCase();
  const memTips = verifiedTipsMemory.get(key) || [];

  const cached = tipsCache.get(key);
  if (!forceFresh && cached && Date.now() - cached.fetchedAt < 10_000) {
    return mergeTips(memTips, cached.items);
  }

  const existingInflight = inflightTips.get(key);
  if (existingInflight) return existingInflight;

  const task = (async () => {
    try {
      const sigs = await rpcCall("getSignaturesForAddress", [
        pda,
        { limit: 12, commitment: "confirmed" },
      ]);

      const validSigs = (sigs || []).filter((s: any) => s.err === null);
      if (validSigs.length === 0) {
        tipsCache.set(key, { items: [], fetchedAt: Date.now() });
        return memTips;
      }

      const decodedTips: OnChainTip[] = [];
      const unseenSigs: string[] = [];

      for (const s of validSigs) {
        if (txBySigCache.has(s.signature)) {
          const hit = txBySigCache.get(s.signature);
          if (hit) decodedTips.push(hit);
        } else {
          unseenSigs.push(s.signature);
        }
      }

      // Fetch ONLY unseen signatures sequentially/slowly so public Devnet never 429s
      for (const sig of unseenSigs) {
        try {
          const tx = await rpcCall(
            "getTransaction",
            [
              sig,
              {
                encoding: "json",
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
              },
            ],
            1
          );
          if (tx && tx.meta?.err === null) {
            const tip = decodeTipEventFromLogs(
              tx.meta?.logMessages,
              sig,
              tx.blockTime
            );
            txBySigCache.set(sig, tip);
            if (tip) decodedTips.push(tip);
          }
        } catch {
          // Skip transient RPC error on individual historical tx
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      tipsCache.set(key, { items: decodedTips, fetchedAt: Date.now() });
      return mergeTips(memTips, decodedTips);
    } catch (err) {
      console.warn("fetchRecentTipsForCreator RPC warning:", err);
      return mergeTips(memTips, cached?.items || []);
    } finally {
      inflightTips.delete(key);
    }
  })();

  inflightTips.set(key, task);
  return task;
}

function mergeTips(a: OnChainTip[], b: OnChainTip[]): OnChainTip[] {
  const map = new Map<string, OnChainTip>();
  for (const t of [...a, ...b]) {
    if (!map.has(t.signature)) map.set(t.signature, t);
  }
  return Array.from(map.values()).sort((x, y) => y.timestamp - x.timestamp);
}

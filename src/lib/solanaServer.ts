import { PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import { PROGRAM_ID, DEVNET_RPC_URL, MIN_TIP_LAMPORTS } from "@/lib/constants";

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
export const SEND_TIP_DISC = [231, 88, 56, 242, 241, 6, 31, 59];
const TIP_EVENT_DISC = [213, 36, 191, 50, 28, 25, 189, 252];
const SYSTEM_PROGRAM_ID = SystemProgram.programId.toBase58();

const INVOKE_LOG_RE = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/;
const EXIT_LOG_RE = /^Program ([1-9A-HJ-NP-Za-km-z]+) (?:success|failed:.*)$/;

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

function decodeTipEventBuffer(
  buf: Buffer,
  signature: string,
  fallbackBlockTime?: number | null
): OnChainTip | null {
  try {
    if (!hasDiscriminator(buf, TIP_EVENT_DISC)) return null;
    if (buf.length < 8 + 32 + 32 + 8 + 1 + 4 + 4 + 8) return null;

    let offset = 8;
    const creator = new PublicKey(buf.slice(offset, offset + 32)).toBase58();
    offset += 32;
    const donor = new PublicKey(buf.slice(offset, offset + 32)).toBase58();
    offset += 32;
    const amountLamports = Number(buf.readBigUInt64LE(offset));
    offset += 8;
    const tier = buf.readUInt8(offset);
    offset += 1;

    if (offset + 4 > buf.length) return null;
    const nLen = buf.readUInt32LE(offset);
    offset += 4;
    if (nLen > 256 || offset + nLen > buf.length) return null;
    const displayName = buf.slice(offset, offset + nLen).toString("utf8");
    offset += nLen;

    if (offset + 4 > buf.length) return null;
    const mLen = buf.readUInt32LE(offset);
    offset += 4;
    if (mLen > 1024 || offset + mLen > buf.length) return null;
    const message = buf.slice(offset, offset + mLen).toString("utf8");
    offset += mLen;

    if (offset + 8 > buf.length) return null;
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
    return null;
  }
}

/**
 * Decodes TipEvent logs ONLY when emitted directly inside a Solstream invocation stack frame.
 * Ignores arbitrary "Program data:" lines emitted by other programs in the transaction.
 */
export function decodeTipEventsForProgram(
  logs: string[] | undefined | null,
  signature: string,
  fallbackBlockTime?: number | null,
  targetProgramId: string = PROGRAM_ID.toBase58()
): OnChainTip[] {
  if (!logs || logs.length === 0) return [];
  const programStack: string[] = [];
  const events: OnChainTip[] = [];

  for (const log of logs) {
    const invokeMatch = INVOKE_LOG_RE.exec(log);
    if (invokeMatch) {
      programStack.push(invokeMatch[1]);
      continue;
    }

    const exitMatch = EXIT_LOG_RE.exec(log);
    if (exitMatch) {
      const exitedPid = exitMatch[1];
      if (programStack[programStack.length - 1] === exitedPid) {
        programStack.pop();
      } else {
        const idx = programStack.lastIndexOf(exitedPid);
        if (idx !== -1) programStack.splice(idx);
      }
      continue;
    }

    if (!log.startsWith("Program data: ")) continue;
    if (programStack[programStack.length - 1] !== targetProgramId) continue;

    try {
      const b64 = log.slice("Program data: ".length).trim();
      const buf = Buffer.from(b64, "base64");
      const decoded = decodeTipEventBuffer(buf, signature, fallbackBlockTime);
      if (decoded) events.push(decoded);
    } catch {
      continue;
    }
  }

  return events;
}

interface VerifiedSendTipIx {
  donor: string;
  creatorAccount: string;
  authority: string;
  amountLamports: number;
  tier: number;
}

/**
 * Strictly validates a Solana transaction as an executed Solstream `send_tip` call:
 * 1. Transaction exists and succeeded (meta.err === null).
 * 2. Contains a Solstream instruction whose data starts with SEND_TIP_DISC.
 * 3. Validates IDL account layout (donor, creator_account, authority, system_program),
 *    donor required-signer status, and creator_account PDA derivation.
 * 4. Decodes TipEvent strictly from logs scoped to PROGRAM_ID's execution frame.
 * 5. Enforces event.creator === authority, event.donor === donor, matching amount/tier,
 *    and optional expectedCreatorAuthority match.
 */
export function verifySolstreamTipTransaction(
  tx: any,
  signature: string,
  expectedCreatorAuthority?: string
): OnChainTip | null {
  if (!tx || !tx.meta || tx.meta.err !== null) return null;

  const message = tx.transaction?.message;
  if (!message) return null;

  const staticKeys: string[] = Array.isArray(message.accountKeys)
    ? message.accountKeys
        .map((k: any) => (typeof k === "string" ? k : k?.pubkey))
        .filter((k: any): k is string => typeof k === "string" && k.length > 0)
    : [];

  const loadedWritable: string[] = Array.isArray(tx.meta.loadedAddresses?.writable)
    ? tx.meta.loadedAddresses.writable
    : [];
  const loadedReadonly: string[] = Array.isArray(tx.meta.loadedAddresses?.readonly)
    ? tx.meta.loadedAddresses.readonly
    : [];
  const allAccountKeys = [...staticKeys, ...loadedWritable, ...loadedReadonly];

  const numRequiredSignatures = Number(
    message.header?.numRequiredSignatures ?? 0
  );
  if (
    allAccountKeys.length === 0 ||
    !Number.isInteger(numRequiredSignatures) ||
    numRequiredSignatures <= 0
  ) {
    return null;
  }

  const programIdStr = PROGRAM_ID.toBase58();
  const candidateInstructions: any[] = [
    ...(Array.isArray(message.instructions) ? message.instructions : []),
  ];
  if (Array.isArray(tx.meta.innerInstructions)) {
    for (const innerGroup of tx.meta.innerInstructions) {
      if (Array.isArray(innerGroup?.instructions)) {
        candidateInstructions.push(...innerGroup.instructions);
      }
    }
  }

  const verifiedInstructions: VerifiedSendTipIx[] = [];

  for (const ix of candidateInstructions) {
    if (typeof ix?.programIdIndex !== "number") continue;
    if (allAccountKeys[ix.programIdIndex] !== programIdStr) continue;
    if (!Array.isArray(ix.accounts) || ix.accounts.length < 4) continue;
    if (typeof ix.data !== "string" || !ix.data) continue;

    let ixBuf: Buffer;
    try {
      ixBuf = Buffer.from(bs58.decode(ix.data));
    } catch {
      continue;
    }

    // 8-byte discriminator + 8-byte u64 amount + 1-byte u8 tier
    if (ixBuf.length < SEND_TIP_DISC.length + 9) continue;
    if (!hasDiscriminator(ixBuf, SEND_TIP_DISC)) continue;

    const donorIdx = ix.accounts[0];
    const creatorAccountIdx = ix.accounts[1];
    const authorityIdx = ix.accounts[2];
    const systemProgramIdx = ix.accounts[3];

    if (
      !Number.isInteger(donorIdx) ||
      donorIdx < 0 ||
      donorIdx >= staticKeys.length ||
      donorIdx >= numRequiredSignatures
    ) {
      continue;
    }

    const donor = allAccountKeys[donorIdx];
    const creatorAccount = allAccountKeys[creatorAccountIdx];
    const authority = allAccountKeys[authorityIdx];
    const systemProgram = allAccountKeys[systemProgramIdx];

    if (!donor || !creatorAccount || !authority || !systemProgram) continue;
    if (systemProgram !== SYSTEM_PROGRAM_ID) continue;
    if (expectedCreatorAuthority && authority !== expectedCreatorAuthority) {
      continue;
    }

    try {
      const authorityPk = new PublicKey(authority);
      const [expectedCreatorPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("creator"), authorityPk.toBuffer()],
        PROGRAM_ID
      );
      if (creatorAccount !== expectedCreatorPda.toBase58()) continue;
    } catch {
      continue;
    }

    const ixAmountLamports = Number(ixBuf.readBigUInt64LE(8));
    const ixTier = ixBuf.readUInt8(16);
    if (ixAmountLamports < MIN_TIP_LAMPORTS) continue;

    verifiedInstructions.push({
      donor,
      creatorAccount,
      authority,
      amountLamports: ixAmountLamports,
      tier: ixTier,
    });
  }

  if (verifiedInstructions.length === 0) return null;

  const scopedEvents = decodeTipEventsForProgram(
    tx.meta.logMessages,
    signature,
    tx.blockTime,
    programIdStr
  );
  if (scopedEvents.length === 0) return null;

  for (const ix of verifiedInstructions) {
    const matched = scopedEvents.find(
      (ev) =>
        ev.creator === ix.authority &&
        ev.donor === ix.donor &&
        ev.amountLamports === ix.amountLamports &&
        ev.tier === ix.tier &&
        ev.amountLamports >= MIN_TIP_LAMPORTS &&
        (!expectedCreatorAuthority || ev.creator === expectedCreatorAuthority)
    );
    if (matched) return matched;
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

type OverlayListener = (tip: OnChainTip) => void;

interface GlobalSolStreamStore {
  txBySigCache: Map<string, OnChainTip>;
  processedSignatures: Map<string, number>;
  inflightVerify: Map<string, Promise<{ verified: boolean; alreadyProcessed?: boolean; savedToSupabase?: boolean; ttsEngine?: string | null; tip?: OnChainTip }>>;
  creatorsCache: { items: OnChainCreator[]; fetchedAt: number } | null;
  inflightCreators: Promise<OnChainCreator[]> | null;
  tipsCache: Map<string, { items: OnChainTip[]; fetchedAt: number }>;
  inflightTips: Map<string, Promise<OnChainTip[]>>;
  verifiedTipsMemory: Map<string, OnChainTip[]>;
  overlayListeners: Map<string, Set<OverlayListener>>;
}

const globalForSolStream = globalThis as unknown as {
  __solstreamStore?: GlobalSolStreamStore;
};

const store: GlobalSolStreamStore =
  globalForSolStream.__solstreamStore ??
  (globalForSolStream.__solstreamStore = {
    txBySigCache: new Map(),
    processedSignatures: new Map(),
    inflightVerify: new Map(),
    creatorsCache: null,
    inflightCreators: null,
    tipsCache: new Map(),
    inflightTips: new Map(),
    verifiedTipsMemory: new Map(),
    overlayListeners: new Map(),
  });

if (!store.txBySigCache) store.txBySigCache = new Map();
if (!store.processedSignatures) store.processedSignatures = new Map();
if (!store.inflightVerify) store.inflightVerify = new Map();
if (!store.tipsCache) store.tipsCache = new Map();
if (!store.inflightTips) store.inflightTips = new Map();
if (!store.verifiedTipsMemory) store.verifiedTipsMemory = new Map();
if (!store.overlayListeners) store.overlayListeners = new Map();

const txBySigCache = store.txBySigCache;
const processedSignatures = store.processedSignatures;
export const inflightVerify = store.inflightVerify;
const tipsCache = store.tipsCache;
const inflightTips = store.inflightTips;
const verifiedTipsMemory = store.verifiedTipsMemory;
const overlayListeners = store.overlayListeners;

const PROCESSED_SIG_TTL_MS = 24 * 60 * 60 * 1000;

export function isSignatureProcessed(signature: string): boolean {
  const seenAt = processedSignatures.get(signature);
  if (!seenAt) return false;
  if (Date.now() - seenAt > PROCESSED_SIG_TTL_MS) {
    processedSignatures.delete(signature);
    return false;
  }
  return true;
}

export function markSignatureProcessed(signature: string): void {
  if (processedSignatures.size >= 10_000) {
    const oldestKey = processedSignatures.keys().next().value;
    if (oldestKey) processedSignatures.delete(oldestKey);
  }
  processedSignatures.set(signature, Date.now());
}

export function subscribeToOverlayAlerts(
  username: string,
  listener: OverlayListener
): () => void {
  const key = username.toLowerCase();
  let set = overlayListeners.get(key);
  if (!set) {
    set = new Set();
    overlayListeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) overlayListeners.delete(key);
  };
}

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

  // Instantly notify all connected OBS Overlay SSE streams (<10ms latency)
  const listeners = overlayListeners.get(key);
  if (listeners) {
    for (const fn of Array.from(listeners)) {
      try {
        fn(tip);
      } catch {
        // Ignore disconnected stream listeners
      }
    }
  }
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

export async function fetchOnChainCreatorByWallet(
  walletAddress: string
): Promise<OnChainCreator | null> {
  const auth = new PublicKey(walletAddress);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator"), auth.toBuffer()],
    PROGRAM_ID
  );
  const info = await rpcCall("getAccountInfo", [
    pda.toBase58(),
    { encoding: "base64", commitment: "confirmed" },
  ]);
  const b64 = info?.value?.data?.[0];
  if (!b64) return null;
  const buf = Buffer.from(b64, "base64");
  return decodeCreatorAccountBuffer(buf, pda.toBase58());
}

export async function fetchVerifiedTransactionTip(
  signature: string,
  expectedCreatorAuthority?: string
): Promise<OnChainTip | null> {
  // Reject malformed signatures cleanly before querying RPC
  try {
    if (bs58.decode(signature).length !== 64) return null;
  } catch {
    return null;
  }

  // Check verified cache while still enforcing expectedCreatorAuthority
  for (const list of Array.from(verifiedTipsMemory.values())) {
    const found = list.find((t) => t.signature === signature);
    if (found) {
      if (expectedCreatorAuthority && found.creator !== expectedCreatorAuthority) {
        return null;
      }
      return found;
    }
  }

  const cachedTx = txBySigCache.get(signature);
  if (cachedTx) {
    if (expectedCreatorAuthority && cachedTx.creator !== expectedCreatorAuthority) {
      return null;
    }
    return cachedTx;
  }

  const tx = await rpcCall("getTransaction", [
    signature,
    {
      encoding: "json",
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    },
  ]);

  const tip = verifySolstreamTipTransaction(
    tx,
    signature,
    expectedCreatorAuthority
  );

  // Only cache the signature after all verification checks pass
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
          const tip = verifySolstreamTipTransaction(tx, sig);
          if (tip) {
            txBySigCache.set(sig, tip);
            decodedTips.push(tip);
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

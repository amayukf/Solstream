import {
  fetchVerifiedTransactionTip,
  pushVerifiedTipToMemory,
  fetchOnChainCreatorByUsername,
  isSignatureProcessed,
  markSignatureProcessed,
  type OnChainTip,
} from "@/lib/solanaServer";
import {
  getCreatorFromDb,
  upsertCreatorInDb,
  insertTipInDb,
  hasTipSignatureInDb,
  uploadAlertAudioToStorage,
  ensureDbReady,
  stripVoteTagForSpeech,
} from "@/lib/supabaseDb";
import { isReservedHandle } from "@/lib/constants";

const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam

export function sanitizeForTts(text: string): string {
  const blocked = /\b(nigger|faggot|kike|chink|tranny)\b/gi;
  return stripVoteTagForSpeech(text).replace(blocked, "***").trim();
}

async function generateElevenLabsAudioBuffer(
  voiceId: string,
  text: string
): Promise<Buffer | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  try {
    const safeVoice =
      voiceId && voiceId.length >= 10 ? voiceId : DEFAULT_VOICE_ID;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      safeVoice
    )}?optimize_streaming_latency=4&output_format=mp3_44100_128`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_flash_v2_5",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.78,
          speed: 1.1,
        },
      }),
      signal: AbortSignal.timeout(7000),
    });

    if (!res.ok) {
      console.warn("ElevenLabs TTS non-OK:", res.status);
      return null;
    }

    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn("ElevenLabs TTS error:", err);
    return null;
  }
}

export type VerifyTipResult =
  | {
      status: 200;
      body: {
        verified: true;
        alreadyProcessed?: boolean;
        savedToSupabase?: boolean;
        ttsEngine?: string | null;
        tip?: OnChainTip;
      };
    }
  | {
      status: 400 | 404 | 409 | 503;
      body: { error: string };
    };

export interface TipProcessorDeps {
  ensureDbReady: typeof ensureDbReady;
  getCreatorFromDb: typeof getCreatorFromDb;
  fetchOnChainCreatorByUsername: typeof fetchOnChainCreatorByUsername;
  upsertCreatorInDb: typeof upsertCreatorInDb;
  fetchVerifiedTransactionTip: typeof fetchVerifiedTransactionTip;
  hasTipSignatureInDb: typeof hasTipSignatureInDb;
  insertTipInDb: typeof insertTipInDb;
  uploadAlertAudioToStorage: typeof uploadAlertAudioToStorage;
  generateTtsBuffer: (voiceId: string, text: string) => Promise<Buffer | null>;
  isSignatureProcessed: typeof isSignatureProcessed;
  markSignatureProcessed: typeof markSignatureProcessed;
  pushVerifiedTipToMemory: typeof pushVerifiedTipToMemory;
}

const DEFAULT_DEPS: TipProcessorDeps = {
  ensureDbReady,
  getCreatorFromDb,
  fetchOnChainCreatorByUsername,
  upsertCreatorInDb,
  fetchVerifiedTransactionTip,
  hasTipSignatureInDb,
  insertTipInDb,
  uploadAlertAudioToStorage,
  generateTtsBuffer: generateElevenLabsAudioBuffer,
  isSignatureProcessed,
  markSignatureProcessed,
  pushVerifiedTipToMemory,
};

const globalForVerify = globalThis as unknown as {
  __solstreamInflightVerifyResults?: Map<string, Promise<VerifyTipResult>>;
};

const inflightVerifyResults =
  globalForVerify.__solstreamInflightVerifyResults ??
  (globalForVerify.__solstreamInflightVerifyResults = new Map());

async function runVerifyPipeline(
  signature: string,
  username: string,
  deps: TipProcessorDeps
): Promise<VerifyTipResult> {
  const dbReady = await deps.ensureDbReady();
  if (!dbReady) {
    return {
      status: 503,
      body: { error: "Service temporarily unavailable" },
    };
  }

  let dbCreator = await deps.getCreatorFromDb(username);
  let chainCreator = null;
  try {
    chainCreator = await deps.fetchOnChainCreatorByUsername(username);
  } catch (err) {
    console.error("Tip verify chain creator lookup failed:", err);
    return {
      status: 503,
      body: { error: "Service temporarily unavailable" },
    };
  }

  if (!dbCreator && chainCreator) {
    dbCreator = await deps.upsertCreatorInDb(chainCreator);
  }

  if (!dbCreator && !chainCreator) {
    return { status: 404, body: { error: "Creator not found" } };
  }

  if (
    !dbCreator ||
    !chainCreator ||
    dbCreator.authority !== chainCreator.authority
  ) {
    console.error("Tip verify creator authority mismatch:", {
      username,
      dbAuthority: dbCreator?.authority ?? null,
      chainAuthority: chainCreator?.authority ?? null,
    });
    return {
      status: 409,
      body: { error: "Creator verification conflict" },
    };
  }

  if (!dbCreator.id) {
    return {
      status: 503,
      body: { error: "Service temporarily unavailable" },
    };
  }

  const resolvedCreator = { ...dbCreator, ...chainCreator };

  let tip: OnChainTip | null = null;
  try {
    tip = await deps.fetchVerifiedTransactionTip(
      signature,
      resolvedCreator.authority
    );
  } catch (err) {
    console.error("Tip verify RPC getTransaction failed:", err);
    return {
      status: 503,
      body: { error: "Service temporarily unavailable" },
    };
  }

  if (!tip) {
    return {
      status: 400,
      body: {
        error:
          "Transaction is invalid, unconfirmed, or not a matching Solstream tip",
      },
    };
  }

  const alreadyInMemory = deps.isSignatureProcessed(signature);
  const alreadyInDb = alreadyInMemory
    ? true
    : await deps.hasTipSignatureInDb(signature);
  if (alreadyInMemory || alreadyInDb) {
    deps.markSignatureProcessed(signature);
    return {
      status: 200,
      body: { verified: true, alreadyProcessed: true },
    };
  }

  const solAmount = (tip.amountLamports / 1_000_000_000).toFixed(3);
  const cleanMsg = sanitizeForTts(tip.message || "");
  const speechScript = cleanMsg
    ? `${tip.displayName || "A fan"} tipped ${solAmount} SOL. ${cleanMsg}`
    : `${tip.displayName || "A fan"} tipped ${solAmount} SOL.`;

  const voiceId = resolvedCreator.voiceId || DEFAULT_VOICE_ID;
  const audioBuffer = await deps.generateTtsBuffer(voiceId, speechScript);
  const audioUrl = audioBuffer
    ? await deps.uploadAlertAudioToStorage(username, signature, audioBuffer)
    : null;

  const ttsEngine = audioUrl ? "elevenlabs" : "browser-speech";
  const verifiedTip: OnChainTip = { ...tip, audioUrl };

  const dbResult = dbCreator.id
    ? await deps.insertTipInDb(dbCreator.id, username, verifiedTip, ttsEngine)
    : { inserted: false, row: null };

  const savedToSupabase = dbResult.inserted;

  if (dbResult.inserted) {
    deps.markSignatureProcessed(signature);
    deps.pushVerifiedTipToMemory(username, verifiedTip);
    return {
      status: 200,
      body: {
        verified: true,
        savedToSupabase,
        ttsEngine,
        tip: verifiedTip,
      },
    };
  }

  if (await deps.hasTipSignatureInDb(signature)) {
    deps.markSignatureProcessed(signature);
    return {
      status: 200,
      body: { verified: true, alreadyProcessed: true },
    };
  }

  return {
    status: 200,
    body: {
      verified: true,
      savedToSupabase,
      ttsEngine,
      tip: verifiedTip,
    },
  };
}

/**
 * Shared fail-closed verification, authority cross-check, ElevenLabs TTS,
 * Supabase persistence, and OBS SSE broadcast pipeline.
 * Coalesces concurrent callers synchronously by signature before any awaits.
 */
export function verifyAndProcessTip(
  signature: string,
  rawUsername: string,
  deps: TipProcessorDeps = DEFAULT_DEPS,
  options?: { coalesce?: boolean }
): Promise<VerifyTipResult> {
  const cleanSig = typeof signature === "string" ? signature.trim() : "";
  const username =
    typeof rawUsername === "string" ? rawUsername.trim().toLowerCase() : "";

  if (!cleanSig || !username || isReservedHandle(username)) {
    return Promise.resolve({
      status: 400,
      body: { error: "Missing or invalid signature or username" },
    });
  }

  // Coalesce across concurrent callers sharing runtime deps (or when opted in by tests).
  const shouldCoalesce = options?.coalesce ?? deps === DEFAULT_DEPS;
  if (shouldCoalesce) {
    const existing = inflightVerifyResults.get(cleanSig);
    if (existing) {
      return existing.then(
        (res: VerifyTipResult): VerifyTipResult =>
          res.status === 200
            ? { status: 200, body: { verified: true, alreadyProcessed: true } }
            : res
      );
    }

    const promise = runVerifyPipeline(cleanSig, username, deps).finally(() => {
      inflightVerifyResults.delete(cleanSig);
    });
    inflightVerifyResults.set(cleanSig, promise);
    return promise;
  }

  return runVerifyPipeline(cleanSig, username, deps);
}

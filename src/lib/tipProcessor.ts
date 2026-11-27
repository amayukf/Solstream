import {
  fetchVerifiedTransactionTip,
  pushVerifiedTipToMemory,
  fetchOnChainCreatorByUsername,
  isSignatureProcessed,
  markSignatureProcessed,
  inflightVerify,
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

const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam

function sanitizeForTts(text: string): string {
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

/**
 * Shared fail-closed verification, authority cross-check, ElevenLabs TTS,
 * Supabase persistence, and OBS SSE broadcast pipeline.
 */
export async function verifyAndProcessTip(
  signature: string,
  rawUsername: string
): Promise<VerifyTipResult> {
  const username = rawUsername.trim().toLowerCase();
  if (!signature || !username) {
    return { status: 400, body: { error: "Missing signature or username" } };
  }

  const dbReady = await ensureDbReady();
  if (!dbReady) {
    return {
      status: 503,
      body: { error: "Service temporarily unavailable" },
    };
  }

  let dbCreator = await getCreatorFromDb(username);
  let chainCreator = null;
  try {
    chainCreator = await fetchOnChainCreatorByUsername(username);
  } catch (err) {
    console.error("Tip verify chain creator lookup failed:", err);
    return {
      status: 503,
      body: { error: "Service temporarily unavailable" },
    };
  }

  if (!dbCreator && chainCreator) {
    dbCreator = await upsertCreatorInDb(chainCreator);
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

  const tip = await fetchVerifiedTransactionTip(
    signature,
    resolvedCreator.authority
  );
  if (!tip) {
    return {
      status: 400,
      body: {
        error: "Transaction is invalid, unconfirmed, or not a matching Solstream tip",
      },
    };
  }

  const pending = inflightVerify.get(signature);
  if (pending) {
    await pending.catch(() => null);
    return {
      status: 200,
      body: { verified: true, alreadyProcessed: true },
    };
  }

  const alreadyInMemory = isSignatureProcessed(signature);
  const alreadyInDb = alreadyInMemory ? true : await hasTipSignatureInDb(signature);
  if (alreadyInMemory || alreadyInDb) {
    markSignatureProcessed(signature);
    return {
      status: 200,
      body: { verified: true, alreadyProcessed: true },
    };
  }

  const processTask = (async () => {
    const solAmount = (tip.amountLamports / 1_000_000_000).toFixed(3);
    const cleanMsg = sanitizeForTts(tip.message || "");
    const speechScript = cleanMsg
      ? `${tip.displayName || "A fan"} tipped ${solAmount} SOL. ${cleanMsg}`
      : `${tip.displayName || "A fan"} tipped ${solAmount} SOL.`;

    const voiceId = resolvedCreator.voiceId || DEFAULT_VOICE_ID;
    const audioBuffer = await generateElevenLabsAudioBuffer(
      voiceId,
      speechScript
    );
    const audioUrl = audioBuffer
      ? await uploadAlertAudioToStorage(username, signature, audioBuffer)
      : null;

    const ttsEngine = audioUrl ? "elevenlabs" : "browser-speech";

    const verifiedTip = {
      ...tip,
      audioUrl,
    };

    const dbResult = dbCreator?.id
      ? await insertTipInDb(dbCreator.id, username, verifiedTip, ttsEngine)
      : { inserted: false, row: null };

    const savedToSupabase = dbResult.inserted;

    if (dbResult.inserted) {
      markSignatureProcessed(signature);
      pushVerifiedTipToMemory(username, verifiedTip);
      return {
        verified: true,
        savedToSupabase,
        ttsEngine,
        tip: verifiedTip,
      };
    }

    if (await hasTipSignatureInDb(signature)) {
      markSignatureProcessed(signature);
      return {
        verified: true,
        alreadyProcessed: true,
      };
    }

    return {
      verified: true,
      savedToSupabase,
      ttsEngine,
      tip: verifiedTip,
    };
  })();

  inflightVerify.set(signature, processTask);
  try {
    const result = await processTask;
    return {
      status: 200,
      body: result as {
        verified: true;
        alreadyProcessed?: boolean;
        savedToSupabase?: boolean;
        ttsEngine?: string | null;
        tip?: OnChainTip;
      },
    };
  } finally {
    inflightVerify.delete(signature);
  }
}

import { NextResponse } from "next/server";
import {
  fetchVerifiedTransactionTip,
  pushVerifiedTipToMemory,
  fetchOnChainCreatorByUsername,
  isSignatureProcessed,
  markSignatureProcessed,
  inflightVerify,
} from "@/lib/solanaServer";
import {
  getCreatorFromDb,
  upsertCreatorInDb,
  insertTipInDb,
  hasTipSignatureInDb,
  uploadAlertAudioToStorage,
  ensureDbReady,
} from "@/lib/supabaseDb";
import {
  checkRateLimit,
  getClientIp,
  rateLimitJsonResponse,
} from "@/lib/rateLimit";

const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam

// Basic safety filter before passing message to ElevenLabs TTS
function sanitizeForTts(text: string): string {
  const blocked = /\b(nigger|faggot|kike|chink|tranny)\b/gi;
  return text.replace(blocked, "***").trim();
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

export async function POST(req: Request) {
  try {
    const rl = checkRateLimit("verify", getClientIp(req), 15, 60_000);
    if (!rl.allowed) {
      return rateLimitJsonResponse(rl.retryAfterSeconds);
    }

    const body = await req.json().catch(() => null);
    const signature =
      typeof body?.signature === "string" ? body.signature.trim() : "";
    const username =
      typeof body?.username === "string"
        ? body.username.trim().toLowerCase()
        : "";

    if (!signature || !username) {
      return NextResponse.json(
        { error: "Missing signature or username" },
        { status: 400 }
      );
    }

    // Fail closed if database is unavailable: return 503 with no TTS or SSE
    const dbReady = await ensureDbReady();
    if (!dbReady) {
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503 }
      );
    }

    // 1. Resolve creator from DB and cross-check authority against Solana on-chain state
    let dbCreator = await getCreatorFromDb(username);
    let chainCreator = null;
    try {
      chainCreator = await fetchOnChainCreatorByUsername(username);
    } catch (err) {
      console.error("POST /api/tips/verify chain creator lookup failed:", err);
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503 }
      );
    }

    if (!dbCreator && chainCreator) {
      dbCreator = await upsertCreatorInDb(chainCreator);
    }

    if (!dbCreator && !chainCreator) {
      return NextResponse.json(
        { error: "Creator not found" },
        { status: 404 }
      );
    }

    if (
      !dbCreator ||
      !chainCreator ||
      dbCreator.authority !== chainCreator.authority
    ) {
      console.error("POST /api/tips/verify creator authority mismatch:", {
        username,
        dbAuthority: dbCreator?.authority ?? null,
        chainAuthority: chainCreator?.authority ?? null,
      });
      return NextResponse.json(
        { error: "Creator verification conflict" },
        { status: 409 }
      );
    }

    if (!dbCreator.id) {
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503 }
      );
    }

    const resolvedCreator = { ...dbCreator, ...chainCreator };

    // 2. Strict zero-trust verification: Solstream send_tip instruction + PDA + signer + scoped TipEvent + creator authority match
    const tip = await fetchVerifiedTransactionTip(
      signature,
      resolvedCreator.authority
    );
    if (!tip) {
      return NextResponse.json(
        { error: "Transaction is invalid, unconfirmed, or not a matching Solstream tip" },
        { status: 400 }
      );
    }

    // 3. Coalesce concurrent calls & enforce idempotency before running TTS or SSE
    const pending = inflightVerify.get(signature);
    if (pending) {
      await pending.catch(() => null);
      return NextResponse.json({
        verified: true,
        alreadyProcessed: true,
      });
    }

    const alreadyInMemory = isSignatureProcessed(signature);
    const alreadyInDb = alreadyInMemory ? true : await hasTipSignatureInDb(signature);
    if (alreadyInMemory || alreadyInDb) {
      markSignatureProcessed(signature);
      return NextResponse.json({
        verified: true,
        alreadyProcessed: true,
      });
    }

    const processTask = (async () => {
      // 4. Generate TTS & upload to Supabase Storage only after verification + creator match + idempotency
      const solAmount = (tip.amountLamports / 1_000_000_000).toFixed(3);
      const cleanMsg = sanitizeForTts(tip.message || "");
      const speechScript = `${tip.displayName || "A fan"} tipped ${solAmount} SOL. ${cleanMsg}`;

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

      // 5. Persist into DB (URL or null only); push to SSE only if DB insert succeeded
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

      // If insert returned false due to unique constraint conflict, treat as idempotent replay
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
      return NextResponse.json(result);
    } finally {
      inflightVerify.delete(signature);
    }
  } catch (err) {
    console.error("POST /api/tips/verify failed:", err);
    return NextResponse.json(
      { error: "Failed to verify on-chain tip" },
      { status: 500 }
    );
  }
}

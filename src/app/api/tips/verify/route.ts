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
} from "@/lib/supabaseDb";

const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Adam

// Basic safety filter before passing message to ElevenLabs TTS
function sanitizeForTts(text: string): string {
  const blocked = /\b(nigger|faggot|kike|chink|tranny)\b/gi;
  return text.replace(blocked, "***").trim();
}

async function generateElevenLabsDataUrl(
  voiceId: string,
  text: string
): Promise<string | null> {
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

    const buf = Buffer.from(await res.arrayBuffer());
    return `data:audio/mpeg;base64,${buf.toString("base64")}`;
  } catch (err) {
    console.warn("ElevenLabs TTS error:", err);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
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

    // 1. Resolve creator first (DB lookup -> fallback to Solana Devnet -> 404 if absent)
    let dbCreator = await getCreatorFromDb(username);
    let chainCreator = null;
    if (!dbCreator) {
      chainCreator = await fetchOnChainCreatorByUsername(username);
      if (chainCreator) {
        dbCreator = await upsertCreatorInDb(chainCreator);
      }
    }

    const resolvedCreator = dbCreator || chainCreator;
    if (!resolvedCreator) {
      return NextResponse.json(
        { error: "Creator not found" },
        { status: 404 }
      );
    }

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
      // 4. Generate TTS only after verification + creator match + idempotency check
      const solAmount = (tip.amountLamports / 1_000_000_000).toFixed(3);
      const cleanMsg = sanitizeForTts(tip.message || "");
      const speechScript = `${tip.displayName || "A fan"} tipped ${solAmount} SOL. ${cleanMsg}`;

      const voiceId = resolvedCreator.voiceId || DEFAULT_VOICE_ID;
      const ttsEngine = process.env.ELEVENLABS_API_KEY
        ? "elevenlabs"
        : "browser-speech";
      const audioDataUrl = await generateElevenLabsDataUrl(
        voiceId,
        speechScript
      );

      const verifiedTip = {
        ...tip,
        audioDataUrl,
      };

      // 5. Persist into DB; push to SSE only if DB insert actually succeeded
      const dbResult = dbCreator?.id
        ? await insertTipInDb(
            dbCreator.id,
            username,
            verifiedTip,
            audioDataUrl ? "elevenlabs" : "browser-speech"
          )
        : { inserted: false, row: null };

      const savedToSupabase = dbResult.inserted;

      if (dbResult.inserted) {
        markSignatureProcessed(signature);
        pushVerifiedTipToMemory(username, verifiedTip);
        return {
          verified: true,
          savedToSupabase,
          ttsEngine: audioDataUrl ? "elevenlabs" : ttsEngine,
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
        ttsEngine: audioDataUrl ? "elevenlabs" : ttsEngine,
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

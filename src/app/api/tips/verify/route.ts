import { NextResponse } from "next/server";
import {
  fetchVerifiedTransactionTip,
  pushVerifiedTipToMemory,
  fetchOnChainCreatorByUsername,
} from "@/lib/solanaServer";
import {
  getCreatorFromDb,
  upsertCreatorInDb,
  insertTipInDb,
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

    // 1. Zero-trust on-chain verification: fetch tx from Devnet RPC and decode TipEvent
    const tip = await fetchVerifiedTransactionTip(signature);
    if (!tip) {
      return NextResponse.json(
        { error: "Transaction not confirmed or did not emit a valid TipEvent" },
        { status: 400 }
      );
    }

    // 2. Resolve creator from Supabase or Solana Devnet and lock recipient authority
    let dbCreator = await getCreatorFromDb(username);
    if (!dbCreator) {
      const chainCreator = await fetchOnChainCreatorByUsername(username);
      if (chainCreator) {
        dbCreator = await upsertCreatorInDb(chainCreator);
      }
    }

    if (dbCreator && dbCreator.authority !== tip.creator) {
      return NextResponse.json(
        { error: "Tip recipient does not match creator authority" },
        { status: 400 }
      );
    }

    // 3. Internalized ElevenLabs TTS (only executes after on-chain verification passes)
    const solAmount = (tip.amountLamports / 1_000_000_000).toFixed(3);
    const cleanMsg = sanitizeForTts(tip.message || "");
    const speechScript = `${tip.displayName || "A fan"} tipped ${solAmount} SOL. ${cleanMsg}`;

    const voiceId = dbCreator?.voiceId || DEFAULT_VOICE_ID;
    const ttsEngine = process.env.ELEVENLABS_API_KEY
      ? "elevenlabs"
      : "browser-speech";
    const audioDataUrl = await generateElevenLabsDataUrl(voiceId, speechScript);

    const verifiedTip = {
      ...tip,
      audioDataUrl,
    };

    // 4. Persist verified tip into Supabase Postgres (triggers Supabase Realtime postgres_changes)
    let savedToSupabase = false;
    if (dbCreator?.id) {
      const dbResult = await insertTipInDb(
        dbCreator.id,
        username,
        verifiedTip,
        audioDataUrl ? "elevenlabs" : "browser-speech"
      );
      savedToSupabase = dbResult.inserted || true;
    }

    // 5. Also push to local SSE memory stream for instant local OBS notification
    pushVerifiedTipToMemory(username, verifiedTip);

    return NextResponse.json({
      verified: true,
      savedToSupabase,
      ttsEngine: audioDataUrl ? "elevenlabs" : ttsEngine,
      tip: verifiedTip,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to verify on-chain tip" },
      { status: 500 }
    );
  }
}

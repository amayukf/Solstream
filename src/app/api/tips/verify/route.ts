import { NextResponse } from "next/server";
import {
  fetchVerifiedTransactionTip,
  pushVerifiedTipToMemory,
  fetchOnChainCreatorByUsername,
} from "@/lib/solanaServer";

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
    const safeVoice = voiceId && voiceId.length >= 10 ? voiceId : DEFAULT_VOICE_ID;
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(safeVoice)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
        signal: AbortSignal.timeout(9000),
      }
    );

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

    // 2. Ensure the tip recipient matches this creator's on-chain authority
    const creator = await fetchOnChainCreatorByUsername(username);
    if (creator && creator.authority !== tip.creator) {
      return NextResponse.json(
        { error: "Tip recipient does not match creator authority" },
        { status: 400 }
      );
    }

    // 3. Internalized ElevenLabs TTS (only executes after on-chain verification passes)
    const solAmount = (tip.amountLamports / 1_000_000_000).toFixed(3);
    const cleanMsg = sanitizeForTts(tip.message || "");
    const speechScript = `${tip.displayName || "A fan"} tipped ${solAmount} SOL. ${cleanMsg}`;

    const voiceId = creator?.voiceId || DEFAULT_VOICE_ID;
    const audioDataUrl = await generateElevenLabsDataUrl(voiceId, speechScript);

    const verifiedTip = {
      ...tip,
      audioDataUrl,
    };

    pushVerifiedTipToMemory(username, verifiedTip);

    return NextResponse.json({
      verified: true,
      ttsEngine: audioDataUrl ? "elevenlabs" : "browser-speech",
      tip: verifiedTip,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to verify on-chain tip" },
      { status: 500 }
    );
  }
}

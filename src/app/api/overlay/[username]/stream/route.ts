import {
  subscribeToOverlayAlerts,
  fetchOnChainCreatorByUsername,
  fetchRecentTipsForCreator,
  OnChainTip,
} from "@/lib/solanaServer";
import {
  getCreatorFromDb,
  getTipsFromDb,
  normalizeAudioUrl,
} from "@/lib/supabaseDb";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

function sanitizeTipForSse(tip: OnChainTip, includeAudioUrl: boolean): OnChainTip {
  return {
    signature: tip.signature,
    creator: tip.creator,
    donor: tip.donor,
    amountLamports: tip.amountLamports,
    tier: tip.tier,
    displayName: tip.displayName,
    message: tip.message,
    timestamp: tip.timestamp,
    audioUrl: includeAudioUrl ? normalizeAudioUrl(tip.audioUrl) : null,
  };
}

export async function GET(
  req: Request,
  context: { params: { username: string } }
) {
  const rl = checkRateLimit("sse", getClientIp(req), 20, 60_000);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: "Too many stream connections" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rl.retryAfterSeconds),
        },
      }
    );
  }

  const username = context.params.username.toLowerCase();
  const encoder = new TextEncoder();

  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Stream closed
        }
      };

      // Subscribe to real-time verified tips immediately (URL only, never audio bytes)
      const unsubscribe = subscribeToOverlayAlerts(username, (tip: OnChainTip) => {
        send("tip", sanitizeTipForSse(tip, true));
      });

      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepAlive);
        }
      }, 15_000);

      cleanup = () => {
        clearInterval(keepAlive);
        unsubscribe();
      };

      req.signal.addEventListener("abort", cleanup);

      // Push initial creator & recent tips snapshot immediately (keep init payload free of audio bytes)
      try {
        const dbCreator = await getCreatorFromDb(username);
        const creator =
          dbCreator || (await fetchOnChainCreatorByUsername(username));
        let tips = dbCreator ? await getTipsFromDb(username) : [];
        if (tips.length === 0 && creator) {
          tips = await fetchRecentTipsForCreator(username, creator.pda);
        }
        send("init", {
          creator,
          tips: tips.map((t) => sanitizeTipForSse(t, true)),
        });
      } catch {
        send("init", { creator: null, tips: [] });
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

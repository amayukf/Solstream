import {
  subscribeToOverlayAlerts,
  fetchOnChainCreatorByUsername,
  fetchRecentTipsForCreator,
  OnChainTip,
} from "@/lib/solanaServer";
import { getCreatorFromDb, getTipsFromDb } from "@/lib/supabaseDb";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: { username: string } }
) {
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

      // Subscribe to real-time verified tips immediately
      const unsubscribe = subscribeToOverlayAlerts(username, (tip: OnChainTip) => {
        send("tip", tip);
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

      // Push initial creator & recent tips snapshot immediately (Supabase first, Devnet fallback)
      try {
        const dbCreator = await getCreatorFromDb(username);
        const creator =
          dbCreator || (await fetchOnChainCreatorByUsername(username));
        let tips = dbCreator ? await getTipsFromDb(username) : [];
        if (tips.length === 0 && creator) {
          tips = await fetchRecentTipsForCreator(username, creator.pda);
        }
        send("init", { creator, tips });
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

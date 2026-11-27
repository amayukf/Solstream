import { verifyAndProcessTip } from "@/lib/tipProcessor";
import { ACTIONS_CORS_HEADERS, resolveRequestOrigin } from "@/lib/solanaActions";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: ACTIONS_CORS_HEADERS });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ username: string }> }
) {
  try {
    const { username: rawUsername } = await context.params;
    const username = rawUsername.trim().toLowerCase();
    const origin = resolveRequestOrigin(req);
    const body = await req.json().catch(() => null);
    const signature =
      typeof body?.signature === "string" ? body.signature.trim() : "";

    if (!signature) {
      return Response.json(
        { message: "Missing transaction signature" },
        { status: 400, headers: ACTIONS_CORS_HEADERS }
      );
    }

    // Retry briefly while Devnet confirmation settles right after client send
    let lastResult = await verifyAndProcessTip(signature, username);
    for (let attempt = 0; attempt < 3 && lastResult.status === 400; attempt++) {
      await new Promise((r) => setTimeout(r, 1500));
      lastResult = await verifyAndProcessTip(signature, username);
    }

    if (lastResult.status !== 200) {
      return Response.json(
        { message: lastResult.body.error },
        { status: lastResult.status, headers: ACTIONS_CORS_HEADERS }
      );
    }

    return Response.json(
      {
        type: "completed",
        icon: `${origin}/solstream-blink.png`,
        title: `Tip Sent to @${username}! ⚡`,
        description: `Verified on Solana Devnet and queued on @${username}'s OBS alert overlay with AI voice.`,
        label: "Alert Triggered",
      },
      { headers: ACTIONS_CORS_HEADERS }
    );
  } catch (err) {
    console.error("POST /api/actions/tip/[username]/confirm error:", err);
    return Response.json(
      { message: "Failed to confirm Blink tip" },
      { status: 500, headers: ACTIONS_CORS_HEADERS }
    );
  }
}

import { NextResponse } from "next/server";
import { verifyAndProcessTip } from "@/lib/tipProcessor";
import {
  checkRateLimit,
  getClientIp,
  rateLimitJsonResponse,
} from "@/lib/rateLimit";

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

    const result = await verifyAndProcessTip(signature, username);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("POST /api/tips/verify failed:", err);
    return NextResponse.json(
      { error: "Failed to verify on-chain tip" },
      { status: 500 }
    );
  }
}

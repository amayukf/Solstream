import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { fetchConfirmedSignaturesForReference } from "@/lib/solanaServer";
import { verifyAndProcessTip } from "@/lib/tipProcessor";
import {
  checkRateLimit,
  getClientIp,
  rateLimitJsonResponse,
} from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const rl = checkRateLimit("watch_qr", getClientIp(req), 40, 60_000);
    if (!rl.allowed) {
      return rateLimitJsonResponse(rl.retryAfterSeconds);
    }

    const { searchParams } = new URL(req.url);
    const username = (searchParams.get("username") || "").trim().toLowerCase();
    const ref = (searchParams.get("ref") || "").trim();

    if (!username || !ref) {
      return NextResponse.json(
        { error: "Missing username or ref" },
        { status: 400 }
      );
    }

    try {
      new PublicKey(ref);
    } catch {
      return NextResponse.json(
        { error: "Invalid reference public key" },
        { status: 400 }
      );
    }

    const signatures = await fetchConfirmedSignaturesForReference(ref);
    if (signatures.length === 0) {
      return NextResponse.json({ matched: false, signatures: [] });
    }

    const processed: string[] = [];
    for (const sig of signatures) {
      const result = await verifyAndProcessTip(sig, username);
      if (result.status === 200) {
        processed.push(sig);
      }
    }

    return NextResponse.json({
      matched: processed.length > 0,
      signatures: processed,
    });
  } catch (err) {
    console.error("GET /api/tips/watch error:", err);
    return NextResponse.json(
      { error: "Watch check failed" },
      { status: 500 }
    );
  }
}

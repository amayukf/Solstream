import { NextResponse } from "next/server";
import net from "net";
import {
  checkRateLimit,
  getClientIp,
  rateLimitJsonResponse,
} from "@/lib/rateLimit";

function isPrivateOrLocalHostname(hostname: string): boolean {
  const lower = hostname.trim().toLowerCase();
  if (
    !lower ||
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal")
  ) {
    return true;
  }

  const ipType = net.isIP(lower);
  if (ipType === 4) {
    const parts = lower.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  } else if (ipType === 6) {
    if (lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80")) {
      return true;
    }
  }
  return false;
}

function suggestHandleFromUrlAndTitle(urlObj: URL, title: string): string {
  const segments = urlObj.pathname
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  const candidate =
    segments[segments.length - 1]?.replace(/^@/, "") ||
    title.split(/\s+/)[0] ||
    "creator";
  return candidate
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 32);
}

function suggestGoalFromContent(title: string, markdown: string): string {
  const cleanTitle = title
    .replace(/\s*[-|•].*$/, "")
    .replace(/[^a-zA-Z0-9\s!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/mic|audio|podcast/i.test(markdown)) return "Studio mic upgrade";
  if (/cam|stream|gpu|pc/i.test(markdown)) return "Stream setup upgrade";
  if (cleanTitle && cleanTitle.length >= 4) {
    return `${cleanTitle.slice(0, 36)} stream goal`.slice(0, 56);
  }
  return "Creator stream upgrade";
}

export async function POST(req: Request) {
  try {
    const rl = checkRateLimit("firecrawl_import", getClientIp(req), 8, 60_000);
    if (!rl.allowed) {
      return rateLimitJsonResponse(rl.retryAfterSeconds);
    }

    const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "Firecrawl is not configured on this server (missing FIRECRAWL_API_KEY)." },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => null);
    const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return NextResponse.json(
        { error: "Please enter a valid https:// URL." },
        { status: 400 }
      );
    }

    if (parsedUrl.protocol !== "https:") {
      return NextResponse.json(
        { error: "Only public https:// channel URLs are supported." },
        { status: 400 }
      );
    }

    if (isPrivateOrLocalHostname(parsedUrl.hostname)) {
      return NextResponse.json(
        { error: "Private or local URLs are not permitted." },
        { status: 400 }
      );
    }

    const fcRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: parsedUrl.toString(),
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 15000,
      }),
      signal: AbortSignal.timeout(18000),
    });

    if (!fcRes.ok) {
      return NextResponse.json(
        { error: "Firecrawl could not read that URL cleanly." },
        { status: 502 }
      );
    }

    const data = await fcRes.json();
    const title = String(data?.data?.metadata?.title || "");
    const description = String(data?.data?.metadata?.description || "");
    const markdown = String(data?.data?.markdown || "");

    const suggestedHandle = suggestHandleFromUrlAndTitle(parsedUrl, title);
    const suggestedGoal = suggestGoalFromContent(title, `${description} ${markdown.slice(0, 600)}`);

    return NextResponse.json({
      provider: "firecrawl",
      sourceUrl: parsedUrl.toString(),
      title: title.slice(0, 120),
      suggestedHandle,
      suggestedGoal,
    });
  } catch (err) {
    console.error("POST /api/creators/import-profile error:", err);
    return NextResponse.json(
      { error: "Failed to import creator profile" },
      { status: 500 }
    );
  }
}

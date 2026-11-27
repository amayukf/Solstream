import { NextResponse } from "next/server";
import { validatePublicScrapeUrl } from "@/lib/urlSafety";
import {
  checkRateLimit,
  getClientIp,
  rateLimitJsonResponse,
} from "@/lib/rateLimit";

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

    const validated = await validatePublicScrapeUrl(rawUrl);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const fcRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: validated.url.toString(),
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

    const suggestedHandle = suggestHandleFromUrlAndTitle(validated.url, title);
    const suggestedGoal = suggestGoalFromContent(
      title,
      `${description} ${markdown.slice(0, 600)}`
    );

    return NextResponse.json({
      provider: "firecrawl",
      sourceUrl: validated.url.toString(),
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

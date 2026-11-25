import { NextResponse } from "next/server";

interface RateLimitBucketEntry {
  count: number;
  resetAt: number;
}

const globalForRateLimit = globalThis as unknown as {
  __solstreamRateLimits?: Map<string, RateLimitBucketEntry>;
};

const buckets: Map<string, RateLimitBucketEntry> =
  globalForRateLimit.__solstreamRateLimits ??
  (globalForRateLimit.__solstreamRateLimits = new Map());

const MAX_BUCKET_ENTRIES = 10_000;

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const cfIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;
  return "local";
}

export function checkRateLimit(
  scope: string,
  identifier: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const now = Date.now();
  const key = `${scope}:${identifier}`;
  const current = buckets.get(key);

  if (!current || now >= current.resetAt) {
    if (buckets.size >= MAX_BUCKET_ENTRIES) {
      for (const [k, v] of Array.from(buckets.entries())) {
        if (now >= v.resetAt) buckets.delete(k);
        if (buckets.size < MAX_BUCKET_ENTRIES) break;
      }
      if (buckets.size >= MAX_BUCKET_ENTRIES) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey) buckets.delete(oldestKey);
      }
    }

    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - current.count),
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

export function rateLimitJsonResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
      },
    }
  );
}

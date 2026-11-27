import { NextResponse } from "next/server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitJsonResponse,
} from "@/lib/rateLimit";

export interface CoinMarketItem {
  id: string;
  symbol: string;
  name: string;
  category: "l1-infra" | "defi" | "meme";
  role: string;
  image: string | null;
  priceUsd: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  sparkline: number[];
}

interface CoinMeta {
  id: string;
  symbol: string;
  name: string;
  binancePair: string;
  category: "l1-infra" | "defi" | "meme";
  role: string;
}

const SOLANA_ECOSYSTEM_META: CoinMeta[] = [
  {
    id: "solana",
    symbol: "SOL",
    name: "Solana",
    binancePair: "SOLUSDT",
    category: "l1-infra",
    role: "Layer 1 Network",
  },
  {
    id: "jupiter-exchange-solana",
    symbol: "JUP",
    name: "Jupiter",
    binancePair: "JUPUSDT",
    category: "defi",
    role: "DEX Aggregator",
  },
  {
    id: "raydium",
    symbol: "RAY",
    name: "Raydium",
    binancePair: "RAYUSDT",
    category: "defi",
    role: "AMM & Liquidity",
  },
  {
    id: "render-token",
    symbol: "RENDER",
    name: "Render",
    binancePair: "RENDERUSDT",
    category: "l1-infra",
    role: "AI / GPU DePIN",
  },
  {
    id: "pyth-network",
    symbol: "PYTH",
    name: "Pyth Network",
    binancePair: "PYTHUSDT",
    category: "l1-infra",
    role: "Price Oracle",
  },
  {
    id: "jito-governance-token",
    symbol: "JTO",
    name: "Jito",
    binancePair: "JTOUSDT",
    category: "defi",
    role: "Liquid Staking / MEV",
  },
  {
    id: "dogwifcoin",
    symbol: "WIF",
    name: "dogwifhat",
    binancePair: "WIFUSDT",
    category: "meme",
    role: "Community Token",
  },
  {
    id: "bonk",
    symbol: "BONK",
    name: "Bonk",
    binancePair: "BONKUSDT",
    category: "meme",
    role: "Solana Social Token",
  },
];

// Simple in-memory server cache (25s TTL) + inflight deduplication to avoid hitting public rate limits
let cachedPayload: {
  coins: CoinMarketItem[];
  updatedAt: number;
  source: "coingecko" | "binance";
} | null = null;

let inflightPrices: Promise<{
  coins: CoinMarketItem[];
  updatedAt: number;
  source: "coingecko" | "binance";
}> | null = null;

const CACHE_TTL_MS = 25_000;

async function fetchFromCoinGecko(): Promise<CoinMarketItem[]> {
  const ids = SOLANA_ECOSYSTEM_META.map((c) => c.id).join(",");
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=true&price_change_percentage=24h`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(7000),
  });

  if (!res.ok) {
    throw new Error(`CoinGecko HTTP ${res.status}`);
  }

  const raw: any[] = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Empty CoinGecko response");
  }

  const byId = new Map(raw.map((item) => [item.id, item]));

  // Keep consistent curated order with SOL first
  return SOLANA_ECOSYSTEM_META.map((meta) => {
    const row = byId.get(meta.id);
    if (!row) return null;
    const sparkRaw: number[] = row.sparkline_in_7d?.price || [];
    // Downsample 168 hourly points to ~28 points for crisp SVG sparklines
    const step = Math.max(1, Math.floor(sparkRaw.length / 28));
    const sparkline = sparkRaw.filter((_, i) => i % step === 0);

    return {
      id: meta.id,
      symbol: meta.symbol,
      name: meta.name,
      category: meta.category,
      role: meta.role,
      image: row.image || null,
      priceUsd: Number(row.current_price) || 0,
      change24h: Number(row.price_change_percentage_24h) || 0,
      volume24h: Number(row.total_volume) || 0,
      marketCap: Number(row.market_cap) || 0,
      sparkline,
    } satisfies CoinMarketItem;
  }).filter(Boolean) as CoinMarketItem[];
}

async function fetchFromBinance(): Promise<CoinMarketItem[]> {
  const pairs = JSON.stringify(SOLANA_ECOSYSTEM_META.map((c) => c.binancePair));
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(pairs)}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(7000),
  });

  if (!res.ok) {
    throw new Error(`Binance HTTP ${res.status}`);
  }

  const raw: any[] = await res.json();
  const bySymbol = new Map(raw.map((item) => [item.symbol, item]));

  return SOLANA_ECOSYSTEM_META.map((meta) => {
    const row = bySymbol.get(meta.binancePair);
    if (!row) return null;
    return {
      id: meta.id,
      symbol: meta.symbol,
      name: meta.name,
      category: meta.category,
      role: meta.role,
      image: null,
      priceUsd: parseFloat(row.lastPrice) || 0,
      change24h: parseFloat(row.priceChangePercent) || 0,
      volume24h: parseFloat(row.quoteVolume) || 0,
      marketCap: 0,
      sparkline: [],
    } satisfies CoinMarketItem;
  }).filter(Boolean) as CoinMarketItem[];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const forceRefresh = searchParams.get("refresh") === "1";

  if (forceRefresh) {
    const rl = checkRateLimit("prices_refresh", getClientIp(req), 10, 60_000);
    if (!rl.allowed) {
      return rateLimitJsonResponse(rl.retryAfterSeconds);
    }
  }

  if (
    !forceRefresh &&
    cachedPayload &&
    Date.now() - cachedPayload.updatedAt < CACHE_TTL_MS
  ) {
    return NextResponse.json(cachedPayload);
  }

  try {
    if (!inflightPrices) {
      inflightPrices = (async () => {
        try {
          const coins = await fetchFromCoinGecko();
          cachedPayload = {
            coins,
            updatedAt: Date.now(),
            source: "coingecko",
          };
          return cachedPayload;
        } catch (cgErr) {
          console.warn("CoinGecko prices lookup failed, trying Binance:", cgErr);
          const coins = await fetchFromBinance();
          cachedPayload = {
            coins,
            updatedAt: Date.now(),
            source: "binance",
          };
          return cachedPayload;
        }
      })().finally(() => {
        inflightPrices = null;
      });
    }

    const result = await inflightPrices;
    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/prices upstream failure:", err);
    if (cachedPayload) {
      return NextResponse.json(cachedPayload);
    }
    return NextResponse.json(
      { error: "Unable to fetch live market prices right now." },
      { status: 503 }
    );
  }
}

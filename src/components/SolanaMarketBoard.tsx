"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Search,
  Sparkles,
  Activity,
} from "lucide-react";
import type { CoinMarketItem } from "@/app/api/prices/route";

interface SolanaMarketBoardProps {
  onSolPriceLoaded?: (solPriceUsd: number, change24h: number) => void;
}

function formatUsdPrice(price: number): string {
  if (!price || price <= 0) return "$0.00";
  if (price >= 10) {
    return `$${price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (price >= 0.01) {
    return `$${price.toFixed(4)}`;
  }
  if (price >= 0.0001) {
    return `$${price.toFixed(6)}`;
  }
  return `$${price.toFixed(8)}`;
}

function formatCompactUsd(val: number): string {
  if (!val || val <= 0) return "—";
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

function SparklineChart({
  data,
  isPositive,
}: {
  data: number[];
  isPositive: boolean;
}) {
  if (!data || data.length < 2) {
    return <span className="text-[11px] font-mono text-zinc-600">—</span>;
  }

  const width = 112;
  const height = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((val, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const strokeColor = isPositive ? "#14F195" : "#FF4D6D";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export function SolanaMarketBoard({ onSolPriceLoaded }: SolanaMarketBoardProps) {
  const [coins, setCoins] = useState<CoinMarketItem[]>([]);
  const [source, setSource] = useState<string>("coingecko");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "l1-infra" | "defi" | "meme">("all");
  const [search, setSearch] = useState("");
  const [secondsAgo, setSecondsAgo] = useState(0);

  const fetchPrices = useCallback(
    async (manual = false) => {
      if (manual) setIsRefreshing(true);
      try {
        const res = await fetch(
          `/api/prices${manual ? "?refresh=1" : ""}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error("Failed to load market feed");
        const data = await res.json();
        if (Array.isArray(data.coins)) {
          setCoins(data.coins);
          setUpdatedAt(data.updatedAt || Date.now());
          setSource(data.source || "coingecko");
          setError(null);

          const sol = data.coins.find((c: CoinMarketItem) => c.symbol === "SOL");
          if (sol && onSolPriceLoaded) {
            onSolPriceLoaded(sol.priceUsd, sol.change24h);
          }
        }
      } catch (err: any) {
        setError(err?.message || "Unable to fetch live prices");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [onSolPriceLoaded]
  );

  useEffect(() => {
    fetchPrices(false);
    const interval = setInterval(() => fetchPrices(false), 30_000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  useEffect(() => {
    if (!updatedAt) return;
    const tick = () => {
      setSecondsAgo(Math.max(0, Math.floor((Date.now() - updatedAt) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [updatedAt]);

  const solCoin = useMemo(
    () => coins.find((c) => c.symbol === "SOL") || null,
    [coins]
  );

  const filteredCoins = useMemo(() => {
    return coins.filter((c) => {
      const matchCategory = filter === "all" || c.category === filter;
      const q = search.trim().toLowerCase();
      const matchQuery =
        !q ||
        c.symbol.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q);
      return matchCategory && matchQuery;
    });
  }, [coins, filter, search]);

  return (
    <section id="markets" className="pt-20 space-y-6">
      {/* Section Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#9945FF]/10 border border-[#9945FF]/30 text-[11px] font-semibold text-[#C89BFF]">
            <Activity className="w-3.5 h-3.5 text-[#14F195]" />
            <span>LIVE SOLANA ECOSYSTEM MARKETS</span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Solana &amp; Ecosystem Price Feed
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl">
            Real-time market prices powering instant micro-tip USD estimates across the Solana network.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start md:self-auto">
          <div className="px-3 py-1.5 rounded-xl bg-[#13141F] border border-white/10 text-[11px] font-mono text-zinc-400 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#14F195] animate-pulse" />
            <span>
              {updatedAt
                ? `${source === "coingecko" ? "CoinGecko" : "Binance"} · ${secondsAgo}s ago`
                : "Connecting feed..."}
            </span>
          </div>
          <button
            type="button"
            onClick={() => fetchPrices(true)}
            disabled={isRefreshing}
            className="px-3.5 py-1.5 rounded-xl bg-[#13141F] hover:bg-[#1C1D2D] border border-white/10 text-xs font-semibold text-zinc-300 flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-[#14F195]" : ""}`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Featured Solana (SOL) Spotlight Banner */}
      {solCoin && (
        <div className="rounded-3xl bg-gradient-to-br from-[#161529] via-[#13141F] to-[#111B1D] border border-white/10 p-6 sm:p-7 shadow-2xl relative overflow-hidden">
          {/* Subtle ambient glow */}
          <div className="absolute -right-24 -top-24 w-64 h-64 bg-[#14F195]/10 blur-3xl rounded-full pointer-events-none" />
          <div className="absolute -left-24 -bottom-24 w-64 h-64 bg-[#9945FF]/15 blur-3xl rounded-full pointer-events-none" />

          <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            {/* Left: SOL Live Price */}
            <div className="lg:col-span-5 flex items-center gap-4">
              {solCoin.image ? (
                <img
                  src={solCoin.image}
                  alt="Solana"
                  className="w-14 h-14 rounded-2xl bg-black/40 p-1.5 border border-white/10 shadow-lg"
                />
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#9945FF] to-[#14F195] flex items-center justify-center font-display font-bold text-black text-xl">
                  S
                </div>
              )}

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-display text-lg font-bold text-white">
                    Solana
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 font-mono text-[11px] font-semibold text-zinc-300">
                    SOL / USD
                  </span>
                </div>

                <div className="flex items-baseline gap-3">
                  <span className="font-mono tabular-nums text-3xl sm:text-4xl font-bold text-white tracking-tight">
                    {formatUsdPrice(solCoin.priceUsd)}
                  </span>

                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono tabular-nums text-xs font-bold ${
                      solCoin.change24h >= 0
                        ? "bg-[#14F195]/15 text-[#14F195] border border-[#14F195]/30"
                        : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                    }`}
                  >
                    {solCoin.change24h >= 0 ? (
                      <TrendingUp className="w-3.5 h-3.5" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5" />
                    )}
                    {solCoin.change24h >= 0 ? "+" : ""}
                    {solCoin.change24h.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Middle: Market Metrics */}
            <div className="lg:col-span-3 grid grid-cols-2 gap-4 border-t lg:border-t-0 lg:border-l border-white/10 pt-4 lg:pt-0 lg:pl-6">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                  24h Volume
                </div>
                <div className="font-mono tabular-nums text-base font-bold text-white mt-0.5">
                  {formatCompactUsd(solCoin.volume24h)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">
                  Market Cap
                </div>
                <div className="font-mono tabular-nums text-base font-bold text-white mt-0.5">
                  {formatCompactUsd(solCoin.marketCap)}
                </div>
              </div>
            </div>

            {/* Right: Live Micro-Tip USD Equivalents */}
            <div className="lg:col-span-4 bg-black/35 border border-white/10 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#14F195]">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Live SolStream Tip Equivalents</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center pt-1">
                <div className="rounded-xl bg-[#13141F]/90 border border-white/5 py-2 px-1">
                  <div className="text-[11px] text-zinc-400">☕ 0.005 SOL</div>
                  <div className="font-mono tabular-nums text-xs font-bold text-white mt-0.5">
                    ≈ ${(0.005 * solCoin.priceUsd).toFixed(2)}
                  </div>
                </div>
                <div className="rounded-xl bg-[#13141F]/90 border border-white/5 py-2 px-1">
                  <div className="text-[11px] text-zinc-400">🔥 0.025 SOL</div>
                  <div className="font-mono tabular-nums text-xs font-bold text-white mt-0.5">
                    ≈ ${(0.025 * solCoin.priceUsd).toFixed(2)}
                  </div>
                </div>
                <div className="rounded-xl bg-[#13141F]/90 border border-white/5 py-2 px-1">
                  <div className="text-[11px] text-zinc-400">💎 0.05 SOL</div>
                  <div className="font-mono tabular-nums text-xs font-bold text-white mt-0.5">
                    ≈ ${(0.05 * solCoin.priceUsd).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: "all", label: "All Solana Assets" },
            { id: "l1-infra", label: "L1 & Infra" },
            { id: "defi", label: "DeFi" },
            { id: "meme", label: "Community" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id as any)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                filter === tab.id
                  ? "bg-[#9945FF] text-white shadow-lg shadow-[#9945FF]/20"
                  : "bg-[#13141F] text-zinc-400 hover:text-white border border-white/5"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SOL, JUP, RAY..."
            className="w-full bg-[#13141F] border border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#9945FF]"
          />
        </div>
      </div>

      {/* Live Coin Price List Table */}
      <div className="rounded-3xl bg-[#13141F] border border-white/10 overflow-hidden shadow-2xl">
        {isLoading ? (
          <div className="p-8 space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-14 rounded-2xl bg-white/5 animate-pulse"
              />
            ))}
          </div>
        ) : error && coins.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-rose-400 font-medium">{error}</p>
            <button
              type="button"
              onClick={() => fetchPrices(true)}
              className="px-4 py-2 rounded-xl bg-[#9945FF] text-white text-xs font-bold"
            >
              Retry Live Feed
            </button>
          </div>
        ) : filteredCoins.length === 0 ? (
          <div className="p-10 text-center text-xs text-zinc-500">
            No Solana tokens matched your search.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 text-[11px] font-bold uppercase tracking-wider text-zinc-500 bg-black/20">
                  <th className="py-3.5 px-6">#</th>
                  <th className="py-3.5 px-4">Asset</th>
                  <th className="py-3.5 px-4 text-right">Price (USD)</th>
                  <th className="py-3.5 px-4 text-right">24h Change</th>
                  <th className="py-3.5 px-4 hidden md:table-cell text-right">
                    24h Volume
                  </th>
                  <th className="py-3.5 px-4 hidden lg:table-cell text-right">
                    Market Cap
                  </th>
                  <th className="py-3.5 px-6 hidden sm:table-cell text-right">
                    7d Trend
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredCoins.map((coin, idx) => {
                  const isUp = coin.change24h >= 0;
                  const sparkUp =
                    coin.sparkline.length >= 2
                      ? coin.sparkline[coin.sparkline.length - 1] >=
                        coin.sparkline[0]
                      : isUp;

                  return (
                    <tr
                      key={coin.id}
                      className="hover:bg-white/[0.03] transition-colors group"
                    >
                      <td className="py-4 px-6 font-mono text-xs text-zinc-500">
                        {idx + 1}
                      </td>

                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          {coin.image ? (
                            <img
                              src={coin.image}
                              alt={coin.name}
                              className="w-8 h-8 rounded-full bg-black/50 border border-white/10 p-0.5 flex-shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#9945FF] to-[#14F195] flex items-center justify-center font-display font-bold text-black text-xs flex-shrink-0">
                              {coin.symbol.slice(0, 1)}
                            </div>
                          )}

                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-display font-bold text-sm text-white group-hover:text-[#14F195] transition-colors">
                                {coin.name}
                              </span>
                              <span className="font-mono text-[11px] font-semibold text-zinc-400">
                                {coin.symbol}
                              </span>
                            </div>
                            <span className="inline-block text-[10px] text-zinc-500 font-medium">
                              {coin.role}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="py-4 px-4 text-right font-mono tabular-nums text-sm font-bold text-white">
                        {formatUsdPrice(coin.priceUsd)}
                      </td>

                      <td className="py-4 px-4 text-right">
                        <span
                          className={`inline-flex items-center justify-end gap-1 px-2.5 py-1 rounded-lg font-mono tabular-nums text-xs font-bold ${
                            isUp
                              ? "bg-[#14F195]/10 text-[#14F195]"
                              : "bg-rose-500/10 text-rose-400"
                          }`}
                        >
                          {isUp ? (
                            <TrendingUp className="w-3 h-3" />
                          ) : (
                            <TrendingDown className="w-3 h-3" />
                          )}
                          {isUp ? "+" : ""}
                          {coin.change24h.toFixed(2)}%
                        </span>
                      </td>

                      <td className="py-4 px-4 hidden md:table-cell text-right font-mono tabular-nums text-xs text-zinc-300">
                        {formatCompactUsd(coin.volume24h)}
                      </td>

                      <td className="py-4 px-4 hidden lg:table-cell text-right font-mono tabular-nums text-xs text-zinc-300">
                        {formatCompactUsd(coin.marketCap)}
                      </td>

                      <td className="py-4 px-6 hidden sm:table-cell">
                        <div className="flex justify-end">
                          <SparklineChart
                            data={coin.sparkline}
                            isPositive={sparkUp}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

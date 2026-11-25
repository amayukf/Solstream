"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { SolanaLogo } from "@/components/SolanaLogo";
import { SolanaMarketBoard } from "@/components/SolanaMarketBoard";
import { getActiveHandle } from "@/lib/storage";
import { ArrowDown, TrendingUp, TrendingDown } from "lucide-react";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

const PREVIEW_TIERS = [
  { id: "coffee", label: "Coffee", emoji: "☕", sol: 0.005 },
  { id: "fire", label: "Fire", emoji: "🔥", sol: 0.025 },
  { id: "diamond", label: "Diamond", emoji: "💎", sol: 0.05 },
];

export default function HomePage() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [onChainCreators, setOnChainCreators] = useState<
    {
      username: string;
      goalTitle: string;
      goalTargetLamports: number;
      goalCurrentLamports: number;
      totalTips: number;
    }[]
  >([]);
  const [previewTier, setPreviewTier] = useState(PREVIEW_TIERS[2]);
  const [latestRealTip, setLatestRealTip] = useState<{
    displayName: string;
    amountSol: number;
    message: string;
    signature: string;
  } | null>(null);
  const [solTicker, setSolTicker] = useState<{
    price: number;
    chg: number;
  } | null>(null);

  useEffect(() => {
    const stored = getActiveHandle();
    if (stored) setActiveHandle(stored);

    fetch("/api/creators")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.creators) && data.creators.length > 0) {
          setOnChainCreators(data.creators);
          const primaryHandle = stored || data.creators[0].username;
          return fetch(`/api/creators/${encodeURIComponent(primaryHandle)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((creatorData) => {
              const firstTip = creatorData?.tips?.[0];
              if (firstTip) {
                setLatestRealTip({
                  displayName: firstTip.displayName || "Anonymous",
                  amountSol: (Number(firstTip.amountLamports) || 0) / 1_000_000_000,
                  message: firstTip.message || "",
                  signature: firstTip.signature || "",
                });
              }
            });
        }
      })
      .catch(() => {});
  }, []);

  const handleSolPriceLoaded = useCallback((price: number, chg: number) => {
    setSolTicker({ price, chg });
  }, []);

  const handleClaim = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = handle.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (clean) {
      router.push(`/claim?handle=${clean}`);
    } else {
      router.push("/claim");
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0C10] text-[#E0E2EC] selection:bg-[#9945FF] selection:text-white">
      {/* Top Navbar */}
      <header className="w-full max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5">
            <SolanaLogo className="w-6 h-5" />
            <span className="font-display text-xl font-bold tracking-tight text-white">
              SolStream
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm text-zinc-400">
            <a href="#creators" className="hover:text-white transition-colors">
              Explore creators
            </a>
            <a href="#markets" className="hover:text-[#14F195] transition-colors font-medium">
              Live Markets
            </a>
            <a href="#how-it-works" className="hover:text-white transition-colors">
              How it works
            </a>
            {activeHandle && (
              <Link href="/dashboard" className="hover:text-white transition-colors">
                Dashboard
              </Link>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {solTicker && (
            <a
              href="#markets"
              className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#13141F] border border-white/10 hover:border-[#14F195]/40 transition-colors text-xs font-mono tabular-nums"
            >
              <span className="text-zinc-400 font-semibold">SOL</span>
              <span className="text-white font-bold">
                ${solTicker.price.toFixed(2)}
              </span>
              <span
                className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${
                  solTicker.chg >= 0 ? "text-[#14F195]" : "text-rose-400"
                }`}
              >
                {solTicker.chg >= 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {solTicker.chg >= 0 ? "+" : ""}
                {solTicker.chg.toFixed(1)}%
              </span>
            </a>
          )}
          <WalletMultiButton className="!bg-[#1D1B2E] hover:!bg-[#282542] !text-white !font-semibold !text-xs !rounded-xl !h-10 !px-4 !border !border-white/10" />
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-6 pt-10 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column */}
          <div className="lg:col-span-7 space-y-6">
            {/* Live badge */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#14F195]/10 border border-[#14F195]/30 text-xs font-semibold text-[#14F195]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#14F195] animate-ping" />
                <span>Live on Solana devnet</span>
              </div>

              {solTicker && (
                <a
                  href="#markets"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#13141F] border border-white/10 text-xs font-mono tabular-nums text-zinc-300 hover:border-[#9945FF]/50 transition-colors"
                >
                  <span>1 SOL = ${solTicker.price.toFixed(2)}</span>
                </a>
              )}
            </div>

            <h1 className="font-display text-4xl sm:text-6xl font-bold tracking-tight text-white leading-[1.08]">
              Tips that land in your wallet and on your stream.
            </h1>

            <p className="text-base sm:text-lg text-zinc-400 max-w-xl leading-relaxed">
              Fans anywhere tip in SOL. The money goes straight to your wallet, and
              an alert with an AI voice reads their message live on OBS.
            </p>

            {/* Claim Handle Bar */}
            <form onSubmit={handleClaim} className="pt-2 max-w-lg">
              <div className="flex items-center bg-[#13141F] rounded-2xl border border-white/10 p-1.5 focus-within:border-[#9945FF] transition-all shadow-xl">
                <span className="pl-4 pr-1 text-zinc-500 font-mono text-sm select-none">
                  solstream.app/
                </span>
                <input
                  type="text"
                  placeholder="yourhandle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder-zinc-600 font-medium"
                />
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-[#9945FF] hover:bg-[#8A37FF] text-white font-bold text-xs tracking-wide transition-all shadow-lg shadow-[#9945FF]/20"
                >
                  Claim your link
                </button>
              </div>
            </form>

            {/* 3 Pills Below Input */}
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <span className="px-3.5 py-1.5 rounded-full bg-[#13141F] border border-white/5 text-xs text-zinc-400 font-medium">
                Near-zero fees, no platform cut
              </span>
              <span className="px-3.5 py-1.5 rounded-full bg-[#13141F] border border-white/5 text-xs text-zinc-400 font-medium">
                Every tip verified on-chain
              </span>
              <span className="px-3.5 py-1.5 rounded-full bg-[#13141F] border border-white/5 text-xs text-zinc-400 font-medium">
                AI voice stream alerts
              </span>
            </div>
          </div>

          {/* Right Column: Interactive Diagram */}
          <div className="lg:col-span-5 flex flex-col items-center">
            {/* Top Card: Live Fan Page Link */}
            <div className="w-full max-w-md rounded-2xl bg-[#13141F] border border-white/10 p-5 shadow-2xl">
              <div className="flex items-center justify-between text-xs mb-4">
                <span className="text-zinc-300 font-semibold">
                  Fan page ·{" "}
                  <span className="text-white font-mono">
                    @{activeHandle || onChainCreators[0]?.username || "claim"}
                  </span>
                </span>
                <span className="text-zinc-500 font-mono text-[11px]">
                  Direct Devnet transfer
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2.5 mb-4">
                {PREVIEW_TIERS.map((tier) => {
                  const isActive = previewTier.id === tier.id;
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => setPreviewTier(tier)}
                      className={`p-2.5 rounded-xl text-center text-xs transition-all ${
                        isActive
                          ? "bg-[#201738] border-2 border-[#9945FF] font-bold text-white shadow-lg shadow-[#9945FF]/20"
                          : "bg-black/40 border border-white/5 text-zinc-400 hover:border-white/15 hover:text-zinc-200"
                      }`}
                    >
                      {tier.emoji} {tier.label}
                    </button>
                  );
                })}
              </div>

              <Link
                href={
                  activeHandle || onChainCreators[0]?.username
                    ? `/${activeHandle || onChainCreators[0]?.username}`
                    : "/claim"
                }
                className="w-full py-3 rounded-xl bg-[#14F195] hover:bg-[#12DB87] text-[#090A0F] font-black text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-[#14F195]/20"
              >
                <span>Send {previewTier.sol} SOL</span>
                {solTicker && (
                  <span className="text-xs font-mono opacity-75">
                    (≈ ${(previewTier.sol * solTicker.price).toFixed(2)})
                  </span>
                )}
              </Link>
            </div>

            {/* Connecting Arrow */}
            <div className="py-3 flex items-center justify-center">
              <ArrowDown className="w-5 h-5 text-zinc-500 animate-bounce" />
            </div>

            {/* Bottom Card: Real Latest On-Chain OBS Alert */}
            <div className="w-full max-w-md rounded-2xl bg-[#13141F] border-2 border-[#9945FF]/70 p-5 shadow-2xl shadow-[#9945FF]/10 relative">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-2xl">{previewTier.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-bold text-white truncate">
                    {latestRealTip
                      ? `${latestRealTip.displayName} tipped ${latestRealTip.amountSol.toFixed(3)} SOL`
                      : `Instant ${previewTier.sol} SOL OBS Alert`}
                  </div>
                  <div className="text-[11px] text-[#14F195] font-semibold">
                    {latestRealTip
                      ? "Latest confirmed tx on Solana Devnet"
                      : "Verified on Solana Devnet"}
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-xs text-zinc-200 italic mb-3 truncate">
                {latestRealTip
                  ? `"${latestRealTip.message}"`
                  : "Donor message appears live and plays via ElevenLabs TTS"}
              </div>

              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <div className="flex items-end gap-1 h-3.5">
                  <span className="w-1 h-3 bg-[#E031E0] rounded-full animate-pulse" />
                  <span className="w-1 h-5 bg-[#9945FF] rounded-full animate-pulse delay-75" />
                  <span className="w-1 h-2 bg-[#E031E0] rounded-full animate-pulse delay-150" />
                  <span className="w-1 h-4 bg-[#9945FF] rounded-full animate-pulse delay-100" />
                </div>
                <span className="text-[11px]">AI voice reads it on stream</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom 3 Steps */}
        <div
          id="how-it-works"
          className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-20"
        >
          <div className="p-6 rounded-2xl bg-[#13141F] border border-white/5 hover:border-[#9945FF]/30 transition-colors space-y-3">
            <div className="w-7 h-7 rounded-lg bg-[#9945FF]/20 text-[#9945FF] flex items-center justify-center font-mono font-bold text-xs">
              1
            </div>
            <h3 className="font-display text-base font-bold text-white">
              Claim your handle
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Connect Phantom and create your creator profile on Solana.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#13141F] border border-white/5 hover:border-[#9945FF]/30 transition-colors space-y-3">
            <div className="w-7 h-7 rounded-lg bg-[#9945FF]/20 text-[#9945FF] flex items-center justify-center font-mono font-bold text-xs">
              2
            </div>
            <h3 className="font-display text-base font-bold text-white">
              Add the overlay to OBS
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Paste one Browser Source URL. Pick your alert voice.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#13141F] border border-white/5 hover:border-[#9945FF]/30 transition-colors space-y-3">
            <div className="w-7 h-7 rounded-lg bg-[#9945FF]/20 text-[#9945FF] flex items-center justify-center font-mono font-bold text-xs">
              3
            </div>
            <h3 className="font-display text-base font-bold text-white">
              Share your link
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Fans tip from anywhere, and every tip links to its on-chain proof.
            </p>
          </div>
        </div>

        {/* LIVE ON-CHAIN CREATORS DIRECTORY (Zero signup required for fans) */}
        {onChainCreators.length > 0 && (
          <section id="creators" className="pt-20 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
              <div>
                <h2 className="font-display text-2xl font-bold text-white tracking-tight">
                  Active Creators on Solana Devnet
                </h2>
                <p className="text-xs sm:text-sm text-zinc-400">
                  Pick any creator below — connect your Solana wallet and tip directly with zero account creation.
                </p>
              </div>
              <span className="text-[11px] font-mono text-[#14F195]">
                {onChainCreators.length} on-chain profile{onChainCreators.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {onChainCreators.map((c) => {
                const targetSol = (c.goalTargetLamports || 1_000_000_000) / 1_000_000_000;
                const currentSol = (c.goalCurrentLamports || 0) / 1_000_000_000;
                const pct = Math.min(Math.round((currentSol / (targetSol || 1)) * 100), 100);
                return (
                  <Link
                    key={c.username}
                    href={`/${c.username}`}
                    className="p-5 rounded-2xl bg-[#13141F] border border-white/10 hover:border-[#14F195]/50 transition-all group space-y-4 shadow-xl"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#9945FF] to-[#14F195] p-0.5">
                          <div className="w-full h-full rounded-full bg-[#0B0C10] flex items-center justify-center font-display font-bold text-sm text-white uppercase">
                            {c.username.slice(0, 1)}
                          </div>
                        </div>
                        <div>
                          <div className="font-display font-bold text-base text-white group-hover:text-[#14F195] transition-colors">
                            @{c.username}
                          </div>
                          <div className="text-[11px] font-mono text-zinc-500">
                            {c.totalTips} on-chain tip{c.totalTips === 1 ? "" : "s"}
                          </div>
                        </div>
                      </div>
                      <span className="px-3 py-1 rounded-xl bg-[#14F195]/10 text-[#14F195] font-bold text-xs border border-[#14F195]/20 group-hover:bg-[#14F195] group-hover:text-[#090A0F] transition-colors">
                        Tip Now →
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-zinc-400 font-medium truncate pr-2">
                          Goal: {c.goalTitle}
                        </span>
                        <span className="font-mono text-white font-semibold">
                          {currentSol.toFixed(3)} / {targetSol.toFixed(1)} SOL
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#9945FF] to-[#14F195]"
                          style={{ width: `${Math.max(pct, 4)}%` }}
                        />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* LIVE SOLANA & ECOSYSTEM COIN PRICE LIST */}
        <SolanaMarketBoard onSolPriceLoaded={handleSolPriceLoaded} />

        {/* Clean Hackathon Footer */}
        <footer className="mt-20 pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <SolanaLogo className="w-4 h-3.5" />
            <span className="font-display font-semibold text-zinc-300">
              SolStream
            </span>
            <span>· Built for DEV3PACK Solana Hackathon</span>
          </div>

          <div className="flex items-center gap-5 font-mono text-[11px]">
            <a
              href="https://solscan.io/account/BN6Zt6ctB4B5dTs8myMrq6CUp5Lea7jMitG9bp8cGKuA?cluster=devnet"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#14F195] transition-colors"
            >
              Contract: BN6Z...GKuA ↗
            </a>
            <Link href="/dashboard" className="hover:text-white transition-colors">
              Studio
            </Link>
            <Link href="/claim" className="hover:text-white transition-colors">
              Claim Handle
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}

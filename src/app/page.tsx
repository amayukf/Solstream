"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { SolanaLogo } from "@/components/SolanaLogo";
import { getActiveHandle } from "@/lib/storage";
import { ArrowDown } from "lucide-react";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

export default function HomePage() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [activeHandle, setActiveHandle] = useState<string | null>(null);

  useEffect(() => {
    const stored = getActiveHandle();
    if (stored) setActiveHandle(stored);
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
            <span className="text-xl font-bold tracking-tight text-white">
              SolStream
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm text-zinc-400">
            <a href="#features" className="hover:text-white transition-colors">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-white transition-colors">
              How it works
            </a>
            <Link href={activeHandle ? `/${activeHandle}` : "/claim"} className="hover:text-white transition-colors">
              {activeHandle ? `@${activeHandle}` : "Explore creators"}
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <WalletMultiButton className="!bg-[#1D1B2E] hover:!bg-[#282542] !text-white !font-semibold !text-xs !rounded-xl !h-10 !px-4 !border !border-white/10" />
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-6 pt-10 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column */}
          <div className="lg:col-span-7 space-y-6">
            {/* Live badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#14F195]/10 border border-[#14F195]/30 text-xs font-semibold text-[#14F195]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#14F195] animate-ping" />
              <span>Live on Solana devnet</span>
            </div>

            <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-white leading-[1.1]">
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
                ElevenLabs voice alerts
              </span>
            </div>
          </div>

          {/* Right Column: Interactive Diagram */}
          <div className="lg:col-span-5 flex flex-col items-center">
            {/* Top Card: Fan Page Preview */}
            <div className="w-full max-w-md rounded-2xl bg-[#13141F] border border-white/10 p-5 shadow-2xl">
              <div className="flex items-center justify-between text-xs mb-4">
                <span className="text-zinc-300 font-semibold">
                  Fan page · <span className="text-white">@{activeHandle || "yourname"}</span>
                </span>
                <span className="text-zinc-500 font-mono text-[11px]">
                  Phantom connected
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2.5 mb-4">
                <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 text-center text-xs text-zinc-400">
                  Coffee
                </div>
                <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 text-center text-xs text-zinc-400">
                  Fire
                </div>
                <div className="p-2.5 rounded-xl bg-[#201738] border-2 border-[#9945FF] text-center text-xs font-bold text-white shadow-lg shadow-[#9945FF]/20">
                  Diamond
                </div>
              </div>

              <Link
                href={activeHandle ? `/${activeHandle}` : "/claim"}
                className="w-full py-3 rounded-xl bg-[#14F195] hover:bg-[#12DB87] text-[#090A0F] font-black text-sm flex items-center justify-center transition-all shadow-lg shadow-[#14F195]/20"
              >
                Send 0.05 SOL
              </Link>
            </div>

            {/* Connecting Arrow */}
            <div className="py-3 flex items-center justify-center">
              <ArrowDown className="w-5 h-5 text-zinc-500 animate-bounce" />
            </div>

            {/* Bottom Card: Alert Popup Preview */}
            <div className="w-full max-w-md rounded-2xl bg-[#13141F] border-2 border-[#9945FF]/70 p-5 shadow-2xl shadow-[#9945FF]/10 relative">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-2xl">💎</span>
                <div>
                  <div className="text-sm font-extrabold text-white">
                    Abebe_DC tipped 0.05 SOL
                  </div>
                  <div className="text-[11px] text-[#14F195] font-semibold">
                    Verified on Solana
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-xs text-zinc-200 italic mb-3">
                &ldquo;Keep inspiring Addis!&rdquo;
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
        <div id="how-it-works" className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-20">
          <div className="p-6 rounded-2xl bg-[#13141F] border border-white/5 space-y-3">
            <div className="w-7 h-7 rounded-lg bg-[#9945FF]/20 text-[#9945FF] flex items-center justify-center font-black text-xs">
              1
            </div>
            <h3 className="text-base font-bold text-white">Claim your handle</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Connect Phantom and create your creator profile on Solana.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#13141F] border border-white/5 space-y-3">
            <div className="w-7 h-7 rounded-lg bg-[#9945FF]/20 text-[#9945FF] flex items-center justify-center font-black text-xs">
              2
            </div>
            <h3 className="text-base font-bold text-white">Add the overlay to OBS</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Paste one Browser Source URL. Pick your alert voice.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#13141F] border border-white/5 space-y-3">
            <div className="w-7 h-7 rounded-lg bg-[#9945FF]/20 text-[#9945FF] flex items-center justify-center font-black text-xs">
              3
            </div>
            <h3 className="text-base font-bold text-white">Share your link</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Fans tip from anywhere, and every tip links to its on-chain proof.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

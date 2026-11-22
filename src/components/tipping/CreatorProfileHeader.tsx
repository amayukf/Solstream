"use client";

import React from "react";
import { CheckCircle2, Radio, ExternalLink } from "lucide-react";

interface CreatorProfileHeaderProps {
  username: string;
  displayName: string;
  bio?: string;
  authority?: string;
  isLive?: boolean;
}

export const CreatorProfileHeader: React.FC<CreatorProfileHeaderProps> = ({
  username,
  displayName,
  bio = "Live streamer, content creator & Web3 builder.",
  authority,
  isLive = true,
}) => {
  const shortAuthority = authority
    ? `${authority.slice(0, 4)}...${authority.slice(-4)}`
    : null;
  const solscanUrl = authority
    ? `https://solscan.io/account/${authority}?cluster=devnet`
    : null;

  return (
    <div className="relative w-full rounded-2xl glass p-6 md:p-8 overflow-hidden border border-white/10 shadow-xl mb-6">
      {/* Background ambient gradient glow */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-solana-purple/20 blur-[80px] pointer-events-none rounded-full" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-solana-green/15 blur-[70px] pointer-events-none rounded-full" />

      <div className="relative z-10 flex flex-col md:flex-row items-center md:items-start gap-6 text-center md:text-left">
        {/* Creator Avatar with neon border */}
        <div className="relative group">
          <div className="w-24 h-24 md:w-28 md:h-28 rounded-2xl bg-gradient-to-tr from-solana-purple via-pink-500 to-solana-green p-[3px] shadow-glow-purple">
            <div className="w-full h-full rounded-[13px] bg-surface flex items-center justify-center overflow-hidden">
              {/* Fallback geometric avatar with initials */}
              <div className="w-full h-full bg-gradient-to-br from-purple-900 to-indigo-950 flex items-center justify-center text-3xl font-black text-white">
                {displayName ? displayName.slice(0, 2).toUpperCase() : "CR"}
              </div>
            </div>
          </div>
          {isLive && (
            <div className="absolute -bottom-2 -right-2 px-2.5 py-0.5 rounded-full bg-red-500/90 text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-lg border border-red-400/30">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
              <span>LIVE</span>
            </div>
          )}
        </div>

        {/* Info Column */}
        <div className="flex-1">
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5 mb-1.5">
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              {displayName}
            </h1>
            <CheckCircle2 className="w-5 h-5 text-solana-green" />
            <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-zinc-300">
              @{username}
            </span>
          </div>

          <p className="text-sm text-zinc-400 max-w-xl mb-4 leading-relaxed">
            {bio}
          </p>

          <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-xs text-zinc-400">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/5">
              <Radio className="w-3.5 h-3.5 text-solana-green animate-pulse" />
              <span>Devnet Live</span>
            </div>

            {authority && (
              <a
                href={solscanUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/5 transition-colors text-zinc-300"
              >
                <span>Wallet:</span>
                <code className="text-solana-green font-mono">{shortAuthority}</code>
                <ExternalLink className="w-3 h-3 text-zinc-400" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

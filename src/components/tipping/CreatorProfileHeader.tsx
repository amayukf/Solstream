"use client";

import React from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";

interface CreatorProfileHeaderProps {
  username: string;
  bio?: string;
  authority?: string | null;
}

export const CreatorProfileHeader: React.FC<CreatorProfileHeaderProps> = ({
  username,
  bio = "Streaming live on Solana. Tips go straight to my wallet with zero platform cuts.",
  authority,
}) => {
  const shortAuthority = authority
    ? `${authority.slice(0, 4)}...${authority.slice(-4)}`
    : null;
  const solscanUrl = authority
    ? `https://solscan.io/account/${authority}?cluster=devnet`
    : null;

  return (
    <div className="rounded-3xl bg-[#13141F] border border-white/5 p-6 text-center space-y-4">
      {/* Circular Avatar */}
      <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-[#9945FF] via-[#00F0FF] to-[#14F195] p-1 mx-auto">
        <div className="w-full h-full rounded-full bg-[#13141F] flex items-center justify-center font-display text-2xl font-black text-white uppercase">
          {username.slice(0, 1)}
        </div>
      </div>

      <div>
        <div className="inline-flex items-center justify-center gap-1.5">
          <h1 className="font-display text-lg font-bold text-white">
            @{username}
          </h1>
          <CheckCircle2 className="w-4 h-4 text-[#14F195]" />
        </div>
        <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">{bio}</p>
      </div>

      {authority && solscanUrl && (
        <div className="pt-2">
          <a
            href={solscanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#090A0F] hover:bg-white/5 border border-white/10 transition-colors text-[11px] font-mono text-zinc-400 hover:text-white"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#14F195]" />
            <span>{shortAuthority}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
};

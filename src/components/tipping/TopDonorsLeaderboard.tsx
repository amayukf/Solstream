"use client";

import React from "react";
import { Trophy, ExternalLink, Flame } from "lucide-react";

export interface TipRecord {
  id?: string;
  signature: string;
  donor: string;
  displayName?: string;
  amountLamports: number;
  tier: number;
  message?: string;
  timestamp: number;
}

interface TopDonorsLeaderboardProps {
  tips: TipRecord[];
  creatorAuthority?: string;
}

export const TopDonorsLeaderboard: React.FC<TopDonorsLeaderboardProps> = ({
  tips,
  creatorAuthority,
}) => {
  // Aggregate tips by donor and sort descending
  const aggregated = React.useMemo(() => {
    const map = new Map<string, { donor: string; displayName: string; totalLamports: number; count: number; lastSig: string }>();

    tips.forEach((t) => {
      // Exclude creator self-tips if any
      if (creatorAuthority && t.donor === creatorAuthority) return;

      const existing = map.get(t.donor);
      if (existing) {
        existing.totalLamports += t.amountLamports;
        existing.count += 1;
        if (t.displayName && (!existing.displayName || existing.displayName === "Anonymous Fan")) {
          existing.displayName = t.displayName;
        }
      } else {
        map.set(t.donor, {
          donor: t.donor,
          displayName: t.displayName || "Anonymous Fan",
          totalLamports: t.amountLamports,
          count: 1,
          lastSig: t.signature,
        });
      }
    });

    return Array.from(map.values()).sort(
      (a, b) => b.totalLamports - a.totalLamports
    );
  }, [tips, creatorAuthority]);

  const getRankBadge = (idx: number) => {
    if (idx === 0) return <span className="text-xl">🥇</span>;
    if (idx === 1) return <span className="text-xl">🥈</span>;
    if (idx === 2) return <span className="text-xl">🥉</span>;
    return (
      <span className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-xs font-mono font-bold text-zinc-400">
        #{idx + 1}
      </span>
    );
  };

  return (
    <div className="w-full rounded-2xl glass p-5 md:p-6 border border-white/10 shadow-lg">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-yellow-500/10 flex items-center justify-center text-yellow-500 border border-yellow-500/20">
          <Trophy className="w-4 h-4" />
        </div>
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Top Supporters
        </h3>
      </div>

      {aggregated.length === 0 ? (
        <div className="py-8 text-center text-zinc-500 text-xs flex flex-col items-center gap-2">
          <Flame className="w-5 h-5 text-zinc-600" />
          <span>No tips yet. Be the first to tip and claim #1 spot!</span>
        </div>
      ) : (
        <div className="space-y-2.5">
          {aggregated.slice(0, 5).map((supporter, idx) => {
            const solAmount = (supporter.totalLamports / 1_000_000_000).toFixed(3);
            const shortAddr = `${supporter.donor.slice(0, 4)}...${supporter.donor.slice(-4)}`;
            const solscanUrl = `https://solscan.io/tx/${supporter.lastSig}?cluster=devnet`;

            return (
              <div
                key={supporter.donor}
                className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-7 flex items-center justify-center">
                    {getRankBadge(idx)}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-zinc-200">
                      {supporter.displayName}
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono">
                      {shortAddr}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <span className="text-xs font-black text-solana-green font-mono">
                      {solAmount} SOL
                    </span>
                    <span className="block text-[9px] text-zinc-500">
                      {supporter.count} {supporter.count === 1 ? "tip" : "tips"}
                    </span>
                  </div>
                  <a
                    href={solscanUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-500 hover:text-white transition-colors p-1"
                    title="View transaction on Solscan"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

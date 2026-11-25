"use client";

import React, { useMemo } from "react";
import { Flame } from "lucide-react";
import type { TipRecord } from "@/lib/storage";

interface TopDonorsLeaderboardProps {
  tips: TipRecord[];
  username: string;
}

interface AggregatedSupporter {
  donorKey: string;
  displayName: string;
  totalLamports: number;
  count: number;
  latestSig: string;
  latestTimestamp: number;
}

export const TopDonorsLeaderboard: React.FC<TopDonorsLeaderboardProps> = ({
  tips,
  username,
}) => {
  const aggregated = useMemo(() => {
    const map = new Map<string, AggregatedSupporter>();

    for (const t of tips) {
      const donorKey = t.donor || t.displayName || t.signature;
      const existing = map.get(donorKey);

      if (existing) {
        existing.totalLamports += t.amountLamports;
        existing.count += 1;
        if (t.timestamp > existing.latestTimestamp) {
          existing.latestTimestamp = t.timestamp;
          existing.latestSig = t.signature;
        }
        if (
          t.displayName &&
          t.displayName !== "Anonymous" &&
          existing.displayName === "Anonymous"
        ) {
          existing.displayName = t.displayName;
        }
      } else {
        map.set(donorKey, {
          donorKey,
          displayName: t.displayName || "Anonymous",
          totalLamports: t.amountLamports,
          count: 1,
          latestSig: t.signature,
          latestTimestamp: t.timestamp,
        });
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => b.totalLamports - a.totalLamports
    );
  }, [tips]);

  return (
    <div className="rounded-3xl bg-[#13141F] border border-white/5 p-6 space-y-4">
      <h2 className="font-display text-sm font-bold text-white">
        Top supporters
      </h2>

      {aggregated.length === 0 ? (
        <div className="py-8 text-center text-xs text-zinc-500 space-y-2">
          <Flame className="w-6 h-6 mx-auto text-zinc-600" />
          <p>No tips received yet.</p>
          <p className="text-[11px] text-zinc-600">
            Be the first supporter to tip @{username}!
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {aggregated.slice(0, 5).map((s, idx) => {
            const medalBg =
              idx === 0
                ? "bg-[#FFD700] text-black"
                : idx === 1
                ? "bg-[#E5E7EB] text-black"
                : idx === 2
                ? "bg-[#CD7F32] text-black"
                : "bg-[#1A1B29] text-zinc-400";
            const shortSig = `${s.latestSig.slice(0, 4)}...${s.latestSig.slice(-4)}`;
            const solscanUrl = `https://solscan.io/tx/${s.latestSig}?cluster=devnet`;
            const solAmt = (s.totalLamports / 1_000_000_000).toFixed(3);

            return (
              <div
                key={s.donorKey}
                className="flex items-center justify-between p-3 rounded-2xl bg-[#090A0F] border border-white/5"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-6 h-6 rounded-full font-black text-xs flex items-center justify-center flex-shrink-0 ${medalBg}`}
                  >
                    {idx + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">
                      {s.displayName}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] font-mono">
                      <a
                        href={solscanUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#9945FF] hover:underline"
                      >
                        View tx ({shortSig})
                      </a>
                      {s.count > 1 && (
                        <span className="text-zinc-500">· {s.count} tips</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-xs font-mono tabular-nums font-bold text-[#14F195] flex-shrink-0 pl-2">
                  {solAmt} SOL
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-zinc-500 leading-tight pt-2 border-t border-white/5">
        Ranked by total SOL tipped. Every row links to verified on-chain proof on Solscan.
      </p>
    </div>
  );
};

"use client";

import React from "react";

interface StreamGoalCardProps {
  title: string;
  currentSol: number;
  targetSol: number;
}

export const StreamGoalCard: React.FC<StreamGoalCardProps> = ({
  title,
  currentSol,
  targetSol,
}) => {
  const safeTarget = targetSol > 0 ? targetSol : 1;
  const percentage = Math.min(Math.round((currentSol / safeTarget) * 100), 100);

  return (
    <div className="rounded-3xl bg-[#13141F] border border-white/5 p-6 space-y-2.5">
      <div className="flex items-center justify-between text-xs font-bold gap-2">
        <span className="font-display text-white truncate">
          {title || "Stream Goal"}
        </span>
        <span className="text-[#14F195] font-mono tabular-nums flex-shrink-0">
          {currentSol.toFixed(3)} / {safeTarget.toFixed(1)} SOL
        </span>
      </div>

      <div className="w-full h-2.5 bg-black/60 rounded-full overflow-hidden p-0.5 border border-white/5">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#9945FF] to-[#14F195] transition-all duration-500"
          style={{ width: `${Math.max(percentage, 3)}%` }}
        />
      </div>

      <p className="text-[10px] text-zinc-500 leading-tight">
        Progress is verified directly from the creator&apos;s on-chain account.
      </p>
    </div>
  );
};

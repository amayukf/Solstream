"use client";

import React from "react";
import { Target, Sparkles } from "lucide-react";

interface StreamGoalCardProps {
  title: string;
  currentLamports: number | bigint;
  targetLamports: number | bigint;
}

export const StreamGoalCard: React.FC<StreamGoalCardProps> = ({
  title,
  currentLamports,
  targetLamports,
}) => {
  const currentSol = Number(currentLamports) / 1_000_000_000;
  const targetSol = Number(targetLamports) / 1_000_000_000 || 1;
  const percentage = Math.min(Math.round((currentSol / targetSol) * 100), 100);

  return (
    <div className="w-full rounded-2xl glass p-5 md:p-6 border border-white/10 shadow-lg mb-6 relative overflow-hidden">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-solana-purple/20 flex items-center justify-center text-solana-purple border border-solana-purple/30">
            <Target className="w-4 h-4" />
          </div>
          <div>
            <span className="text-xs uppercase tracking-wider text-zinc-400 font-bold block">
              Active Stream Goal
            </span>
            <h2 className="text-sm md:text-base font-bold text-white tracking-tight">
              {title || "Community Stream Goal"}
            </h2>
          </div>
        </div>

        <div className="text-right">
          <span className="text-xs font-medium text-zinc-400">Progress</span>
          <div className="text-sm md:text-base font-black text-solana-green">
            {percentage}%
          </div>
        </div>
      </div>

      {/* Progress Bar Container */}
      <div className="relative w-full h-3.5 bg-black/40 rounded-full overflow-hidden p-0.5 border border-white/5">
        <div
          className="h-full rounded-full bg-gradient-to-r from-solana-purple via-pink-500 to-solana-green transition-all duration-700 ease-out shadow-glow-green"
          style={{ width: `${Math.max(percentage, 2)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-400 mt-2 font-mono">
        <span>{currentSol.toFixed(3)} SOL raised</span>
        <span>Goal: {targetSol.toFixed(2)} SOL</span>
      </div>
    </div>
  );
};

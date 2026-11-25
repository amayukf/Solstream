"use client";

import React from "react";
import { GIFT_TIERS, GiftTier } from "@/lib/constants";

interface MicroTierSelectorProps {
  selectedTier: GiftTier;
  onSelectTier: (tier: GiftTier) => void;
  solUsdPrice?: number | null;
}

export const MicroTierSelector: React.FC<MicroTierSelectorProps> = ({
  selectedTier,
  onSelectTier,
  solUsdPrice,
}) => {
  return (
    <div className="grid grid-cols-3 gap-3">
      {GIFT_TIERS.map((g) => {
        const isSelected = selectedTier.id === g.id;
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => onSelectTier(g)}
            className={`p-3.5 rounded-2xl text-left transition-all ${
              isSelected
                ? "bg-[#1E1838] border-2 border-[#9945FF] shadow-lg shadow-[#9945FF]/20"
                : "bg-[#090A0F] border border-white/5 hover:border-white/15"
            }`}
          >
            <div className="flex items-center justify-between gap-1 mb-1">
              <div className="flex items-center gap-2">
                <span className="text-lg">{g.emoji}</span>
                <span className="font-display text-xs font-bold text-white">
                  {g.name}
                </span>
              </div>
              {solUsdPrice && (
                <span className="text-[10px] font-mono text-zinc-500 hidden sm:inline">
                  ~${(g.amountSol * solUsdPrice).toFixed(2)}
                </span>
              )}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-zinc-400">
              {g.amountSol} SOL
            </div>
          </button>
        );
      })}
    </div>
  );
};

"use client";

import React from "react";
import { GIFT_TIERS, GiftTier } from "@/lib/constants";
import { GiftIcon } from "@/components/tipping/GiftIcon";
import { PencilLine } from "lucide-react";

interface MicroTierSelectorProps {
  selectedTier: GiftTier;
  isCustomSelected: boolean;
  onSelectTier: (tier: GiftTier) => void;
  onSelectCustom: () => void;
  solUsdPrice?: number | null;
}

export const MicroTierSelector: React.FC<MicroTierSelectorProps> = ({
  selectedTier,
  isCustomSelected,
  onSelectTier,
  onSelectCustom,
  solUsdPrice,
}) => {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
        {GIFT_TIERS.map((g) => {
          const isSelected = !isCustomSelected && selectedTier.id === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelectTier(g)}
              className={`group p-3 sm:p-3.5 rounded-2xl text-left transition-all ${
                isSelected
                  ? "bg-[#1E1838] border-2 border-[#9945FF] shadow-lg shadow-[#9945FF]/20"
                  : "bg-[#090A0F] border border-white/5 hover:border-white/15 hover:bg-[#10121D]"
              }`}
            >
              <div className="flex items-center gap-2.5 mb-2">
                <GiftIcon
                  tier={g.id}
                  size="md"
                  className="transition-transform duration-200 group-hover:scale-105"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-xs font-bold text-white truncate">
                    {g.name}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#14F195] font-semibold">
                    {g.amountSol} SOL
                  </div>
                </div>
              </div>

              {solUsdPrice && (
                <div className="text-[10px] font-mono tabular-nums text-zinc-500">
                  ≈ ${(g.amountSol * solUsdPrice).toFixed(2)} USD
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Dedicated Custom Manual Tip Option */}
      <button
        type="button"
        onClick={onSelectCustom}
        className={`w-full p-3 sm:p-3.5 rounded-2xl text-left transition-all flex items-center justify-between gap-3 ${
          isCustomSelected
            ? "bg-gradient-to-r from-[#1D1638] to-[#102624] border-2 border-[#14F195] shadow-lg shadow-[#14F195]/15"
            : "bg-[#090A0F] border border-dashed border-white/15 hover:border-[#14F195]/50 hover:bg-[#10121D]"
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <GiftIcon tier="custom" size="md" />
          <div className="min-w-0">
            <div className="font-display text-xs font-bold text-white flex items-center gap-1.5">
              <span>Custom Amount</span>
              <span className="px-1.5 py-0.5 rounded bg-[#14F195]/15 text-[#14F195] text-[9px] font-mono uppercase tracking-wider">
                Any SOL
              </span>
            </div>
            <div className="text-[11px] text-zinc-400 truncate">
              Write your own amount manually in SOL or pick a quick USD preset
            </div>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex-shrink-0 ${
            isCustomSelected
              ? "bg-[#14F195] text-[#090A0F]"
              : "bg-white/5 text-zinc-300"
          }`}
        >
          <PencilLine className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">
            {isCustomSelected ? "Editing" : "Enter Custom"}
          </span>
        </span>
      </button>
    </div>
  );
};

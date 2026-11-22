"use client";

import React from "react";
import { GIFT_TIERS, GiftTier } from "@/lib/constants";
import { Coins } from "lucide-react";

interface MicroTierSelectorProps {
  selectedTier: GiftTier | null;
  onSelectTier: (tier: GiftTier) => void;
  isCustom: boolean;
  customAmount: string;
  onCustomChange: (val: string) => void;
  onToggleCustom: () => void;
}

export const MicroTierSelector: React.FC<MicroTierSelectorProps> = ({
  selectedTier,
  onSelectTier,
  isCustom,
  customAmount,
  onCustomChange,
  onToggleCustom,
}) => {
  return (
    <div className="w-full mb-6">
      <div className="flex items-center justify-between mb-3">
        <label className="text-sm font-bold text-zinc-200">
          Select Gift Tier
        </label>
        <button
          type="button"
          onClick={onToggleCustom}
          className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-all ${
            isCustom
              ? "bg-solana-purple text-white shadow-glow-purple"
              : "text-zinc-400 hover:text-white bg-white/5"
          }`}
        >
          {isCustom ? "Use Preset Tiers" : "Custom Amount"}
        </button>
      </div>

      {!isCustom ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {GIFT_TIERS.map((tier) => {
            const isSelected = selectedTier?.id === tier.id;
            return (
              <button
                key={tier.id}
                type="button"
                onClick={() => onSelectTier(tier)}
                className={`relative p-3.5 rounded-xl text-left transition-all duration-200 group flex flex-col justify-between ${
                  isSelected
                    ? "bg-card-hover border-2 border-solana-green shadow-glow-green scale-[1.02]"
                    : "glass hover:bg-white/5 border border-white/10 hover:border-white/20"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="text-2xl group-hover:scale-110 transition-transform">
                    {tier.emoji}
                  </span>
                  <span className="text-[11px] font-semibold text-zinc-400">
                    {tier.usdApprox}
                  </span>
                </div>

                <div>
                  <div className="text-xs font-bold text-zinc-200">
                    {tier.name}
                  </div>
                  <div className="text-sm font-black text-solana-green font-mono">
                    {tier.amountSol} SOL
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl glass p-4 border border-solana-purple/30 bg-card/60">
          <label className="block text-xs font-medium text-zinc-300 mb-2">
            Enter Custom Tip Amount (SOL)
          </label>
          <div className="relative">
            <input
              type="number"
              step="0.001"
              min="0.001"
              max="100"
              value={customAmount}
              onChange={(e) => onCustomChange(e.target.value)}
              placeholder="0.05"
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-zinc-500 font-mono text-lg focus:outline-none focus:border-solana-purple"
            />
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-xs text-zinc-400">
              <Coins className="w-4 h-4 text-solana-green" />
              <span className="font-bold text-zinc-300">SOL</span>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2 text-[11px] text-zinc-400">
            <span>Minimum: 0.001 SOL</span>
            {customAmount && Number(customAmount) > 0 && (
              <span className="text-solana-green font-mono">
                ~${(Number(customAmount) * 200).toFixed(2)} USD (approx)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

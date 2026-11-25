"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { GIFT_TIERS, GiftTier } from "@/lib/constants";
import { MicroTierSelector } from "@/components/tipping/MicroTierSelector";
import { AlertCircle, Loader2 } from "lucide-react";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

interface TipFormProps {
  username: string;
  isCreatorReady: boolean;
  solUsdPrice: number | null;
  isLoading: boolean;
  externalError?: string | null;
  onSendTip: (
    amountLamports: number,
    amountSol: number,
    tierId: number,
    displayName: string,
    message: string
  ) => Promise<void>;
}

const PRESET_MESSAGES = [
  "መልካም ስራ! በርታ!",
  "Keep shining! 🔥",
  "Coffee on me ☕",
  "LFG! 🚀",
];

export const TipForm: React.FC<TipFormProps> = ({
  username,
  isCreatorReady,
  solUsdPrice,
  isLoading,
  externalError,
  onSendTip,
}) => {
  const { connected } = useWallet();
  const [selectedGift, setSelectedGift] = useState<GiftTier>(GIFT_TIERS[0]);
  const [displayName, setDisplayName] = useState("");
  const [customAmount, setCustomAmount] = useState(
    GIFT_TIERS[0].amountSol.toString()
  );
  const [message, setMessage] = useState("መልካም ስራ! በርታ!");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSelectGift = (gift: GiftTier) => {
    setSelectedGift(gift);
    setCustomAmount(gift.amountSol.toString());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!connected) {
      setLocalError("Please connect your Solana wallet first.");
      return;
    }

    if (!isCreatorReady) {
      setLocalError(
        `Creator @${username} has not initialized their profile on Solana Devnet yet.`
      );
      return;
    }

    const solVal = parseFloat(customAmount);
    if (isNaN(solVal) || solVal < 0.001) {
      setLocalError("Minimum tip is 0.001 SOL to prevent dust/spam.");
      return;
    }

    const trimmedMsg = message.trim() || "መልካም ስራ!";
    const trimmedName = displayName.trim() || "Anonymous";

    if (new TextEncoder().encode(trimmedMsg).length > 300) {
      setLocalError("Message exceeds the 300-byte on-chain UTF-8 limit.");
      return;
    }
    if (new TextEncoder().encode(trimmedName).length > 96) {
      setLocalError("Display name exceeds the 96-byte on-chain UTF-8 limit.");
      return;
    }

    const lamports = Math.round(solVal * 1_000_000_000);
    await onSendTip(lamports, solVal, selectedGift.id, trimmedName, trimmedMsg);
  };

  const displayError = localError || externalError;
  const parsedAmount = parseFloat(customAmount);
  const usdSuffix =
    solUsdPrice && !isNaN(parsedAmount) && parsedAmount > 0
      ? `(≈ $${(parsedAmount * solUsdPrice).toFixed(2)}) `
      : "";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl bg-[#13141F] border border-white/5 p-7 space-y-5"
    >
      <h2 className="font-display text-base font-bold text-white">Send a tip</h2>

      {/* 6 Preset Gift Tiers */}
      <MicroTierSelector
        selectedTier={selectedGift}
        onSelectTier={handleSelectGift}
        solUsdPrice={solUsdPrice}
      />

      {/* Display Name & Custom Amount */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-zinc-400 mb-1.5 font-medium">
            Display name (optional)
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your display name or handle"
            maxLength={32}
            className="w-full bg-[#090A0F] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-[#9945FF]"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] text-zinc-400 font-medium">
              Custom amount (SOL)
            </label>
            {solUsdPrice && !isNaN(parsedAmount) && parsedAmount > 0 && (
              <span className="text-[11px] font-mono text-[#14F195]">
                ≈ ${(parsedAmount * solUsdPrice).toFixed(2)} USD
              </span>
            )}
          </div>
          <input
            type="number"
            step="0.001"
            min="0.001"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            className="w-full bg-[#090A0F] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white font-mono tabular-nums focus:outline-none focus:border-[#9945FF]"
          />
        </div>
      </div>

      {/* Message Field */}
      <div>
        <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5 font-medium">
          <span>Stream alert message (read live by AI)</span>
          <span className="font-mono tabular-nums">{message.length} / 100</span>
        </div>
        <textarea
          rows={2}
          maxLength={100}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="መልካም ስራ! በርታ! (supports Amharic & English)"
          className="w-full bg-[#090A0F] border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-[#9945FF] resize-none"
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {PRESET_MESSAGES.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setMessage(preset)}
              className="px-2.5 py-1 rounded-full bg-[#090A0F] hover:bg-[#1E1838] border border-white/10 hover:border-[#9945FF]/50 text-[10px] text-zinc-400 hover:text-white transition-colors"
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Error banner */}
      {displayError && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{displayError}</span>
        </div>
      )}

      {/* Action Button */}
      <div>
        {!connected ? (
          <div className="space-y-2.5">
            <div className="w-full flex justify-center">
              <WalletMultiButton className="!w-full !justify-center !h-12 !rounded-2xl !bg-gradient-to-r !from-[#9945FF] !to-[#14F195] !text-[#090A0F] !font-black !text-sm" />
            </div>
            <p className="text-center text-[11px] text-[#14F195] font-medium">
              No SolStream account needed — connect your Solana wallet to tip @{username}
            </p>
          </div>
        ) : (
          <button
            type="submit"
            disabled={isLoading || !isCreatorReady}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#9945FF] to-[#14F195] text-[#090A0F] font-black text-sm tracking-wide transition-all shadow-lg shadow-[#14F195]/20 flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#090A0F]" />
                <span>Sending Tip on Solana Devnet...</span>
              </>
            ) : (
              <span>
                Send {customAmount} SOL {usdSuffix}with Phantom
              </span>
            )}
          </button>
        )}

        <div className="text-center text-[10px] text-zinc-500 mt-2.5">
          Direct on-chain CPI transfer · Zero platform fees
        </div>
      </div>
    </form>
  );
};

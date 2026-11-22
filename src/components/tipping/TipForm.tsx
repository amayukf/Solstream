"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  GIFT_TIERS,
  GiftTier,
  MAX_DISPLAY_NAME_CHARS,
  MAX_MESSAGE_CHARS,
  MIN_TIP_LAMPORTS,
} from "@/lib/constants";
import { Send, Loader2, Sparkles, AlertCircle } from "lucide-react";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

interface TipFormProps {
  selectedTier: GiftTier | null;
  isCustom: boolean;
  customAmount: string;
  onSendTip: (
    amountLamports: number,
    tierId: number,
    displayName: string,
    message: string
  ) => Promise<void>;
  isLoading: boolean;
}

const PRESET_MESSAGES = [
  { label: "መልካም ስራ! 🇪🇹", text: "መልካም ስራ! በርታ!" },
  { label: "Keep shining! 🔥", text: "Loving the stream! Keep shining! 🔥" },
  { label: "Coffee on me ☕", text: "Here is your morning coffee boost ☕" },
  { label: "LFG! 🚀", text: "Amazing stream energy! LFG! 🚀" },
];

export const TipForm: React.FC<TipFormProps> = ({
  selectedTier,
  isCustom,
  customAmount,
  onSendTip,
  isLoading,
}) => {
  const { connected } = useWallet();
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Compute final amount in lamports
  let amountLamports = 0;
  let tierId = 0;

  if (isCustom) {
    const solVal = parseFloat(customAmount);
    if (!isNaN(solVal) && solVal > 0) {
      amountLamports = Math.round(solVal * 1_000_000_000);
    }
    tierId = 0; // Default tier mapping for custom tips
  } else if (selectedTier) {
    amountLamports = selectedTier.lamports;
    tierId = selectedTier.id;
  }

  const solDisplay = (amountLamports / 1_000_000_000).toFixed(3);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!connected) {
      setError("Please connect your Solana wallet first.");
      return;
    }

    if (amountLamports < MIN_TIP_LAMPORTS) {
      setError("Tip must be at least 0.001 SOL to prevent dust/spam.");
      return;
    }

    if (displayName.length > MAX_DISPLAY_NAME_CHARS) {
      setError(`Display name cannot exceed ${MAX_DISPLAY_NAME_CHARS} characters.`);
      return;
    }

    if (message.length > MAX_MESSAGE_CHARS) {
      setError(`Message cannot exceed ${MAX_MESSAGE_CHARS} characters.`);
      return;
    }

    try {
      await onSendTip(
        amountLamports,
        tierId,
        displayName.trim() || "Anonymous Fan",
        message.trim() || "Keep creating amazing content!"
      );
      // Reset form after successful send
      setMessage("");
    } catch (err: any) {
      setError(err?.message || "Transaction failed. Please try again.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      {/* Display Name Input */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-zinc-300">
            Your Display Name (Optional)
          </label>
          <span className="text-[10px] text-zinc-500 font-mono">
            {displayName.length}/{MAX_DISPLAY_NAME_CHARS}
          </span>
        </div>
        <input
          type="text"
          maxLength={MAX_DISPLAY_NAME_CHARS}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Abebe / Fan123"
          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-solana-purple"
        />
      </div>

      {/* Message Textarea */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-zinc-300">
            Stream Alert Message (Read live by AI)
          </label>
          <span className="text-[10px] text-zinc-500 font-mono">
            {message.length}/{MAX_MESSAGE_CHARS}
          </span>
        </div>
        <textarea
          rows={3}
          maxLength={MAX_MESSAGE_CHARS}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Leave a message for the stream and AI voice... (supports Amharic & English)"
          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-solana-purple resize-none"
        />

        {/* Quick Message Suggestions */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {PRESET_MESSAGES.map((preset, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setMessage(preset.text)}
              className="text-[11px] px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors border border-white/5"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Action Button */}
      <div className="pt-2">
        {!connected ? (
          <div className="w-full flex justify-center">
            <WalletMultiButton className="!w-full !justify-center !rounded-xl !py-3.5 !bg-gradient-to-r !from-solana-purple !to-solana-green !text-obsidian !font-bold" />
          </div>
        ) : (
          <button
            type="submit"
            disabled={isLoading || amountLamports < MIN_TIP_LAMPORTS}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-solana-purple via-pink-600 to-solana-green text-obsidian font-extrabold text-base shadow-glow-green hover:opacity-95 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-obsidian" />
                <span>Confirming On Solana Devnet...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 text-obsidian" />
                <span>Send {solDisplay} SOL Tip</span>
                <Send className="w-4 h-4 text-obsidian" />
              </>
            )}
          </button>
        )}
      </div>
    </form>
  );
};

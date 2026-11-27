"use client";

import React, { useState, useRef } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  GIFT_TIERS,
  GiftTier,
  getTierForAmountSol,
} from "@/lib/constants";
import { MicroTierSelector } from "@/components/tipping/MicroTierSelector";
import { GiftIcon } from "@/components/tipping/GiftIcon";
import { AlertCircle, Loader2, Sparkles, Vote } from "lucide-react";
import type { CreatorPollState } from "@/lib/polls";

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
  activePoll?: CreatorPollState | null;
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

const QUICK_CUSTOM_SOL = [0.002, 0.015, 0.5, 1];
const QUICK_CUSTOM_USD = [1, 5, 10, 25];

export const TipForm: React.FC<TipFormProps> = ({
  username,
  isCreatorReady,
  solUsdPrice,
  isLoading,
  externalError,
  activePoll,
  onSendTip,
}) => {
  const { connected } = useWallet();
  const [selectedGift, setSelectedGift] = useState<GiftTier>(GIFT_TIERS[0]);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [selectedVote, setSelectedVote] = useState<"A" | "B" | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [customAmount, setCustomAmount] = useState(
    GIFT_TIERS[0].amountSol.toString()
  );
  const [message, setMessage] = useState("መልካም ስራ! በርታ!");
  const [localError, setLocalError] = useState<string | null>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  const handleSelectGift = (gift: GiftTier) => {
    setIsCustomMode(false);
    setSelectedGift(gift);
    setCustomAmount(gift.amountSol.toString());
  };

  const handleSelectCustom = () => {
    setIsCustomMode(true);
    setTimeout(() => {
      customInputRef.current?.focus();
      customInputRef.current?.select();
    }, 30);
  };

  const handleManualAmountChange = (val: string) => {
    setCustomAmount(val);
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      const matched = GIFT_TIERS.find(
        (g) => Math.abs(g.amountSol - num) < 0.00001
      );
      if (matched) {
        setSelectedGift(matched);
      } else {
        setIsCustomMode(true);
        setSelectedGift(getTierForAmountSol(num));
      }
    } else {
      setIsCustomMode(true);
    }
  };

  const applyQuickSol = (sol: number) => {
    setIsCustomMode(true);
    setCustomAmount(sol.toString());
    setSelectedGift(getTierForAmountSol(sol));
  };

  const applyQuickUsd = (usd: number) => {
    if (!solUsdPrice || solUsdPrice <= 0) return;
    const sol = Math.max(0.001, Number((usd / solUsdPrice).toFixed(4)));
    setIsCustomMode(true);
    setCustomAmount(sol.toString());
    setSelectedGift(getTierForAmountSol(sol));
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

    const baseMsg = message.trim() || "መልካም ስራ!";
    const trimmedMsg =
      selectedVote && activePoll?.isActive
        ? `[VOTE:${selectedVote}] ${baseMsg}`
        : baseMsg;
    const trimmedName = displayName.trim() || "Anonymous";

    if (new TextEncoder().encode(trimmedMsg).length > 300) {
      setLocalError("Message exceeds the 300-byte on-chain UTF-8 limit.");
      return;
    }
    if (new TextEncoder().encode(trimmedName).length > 96) {
      setLocalError("Display name exceeds the 96-byte on-chain UTF-8 limit.");
      return;
    }

    if (selectedVote && activePoll?.isActive) {
      const minVoteSol = (activePoll.minVoteLamports || 1_000_000) / 1_000_000_000;
      if (solVal < minVoteSol) {
        setLocalError(`Minimum tip to vote in this poll is ${minVoteSol} SOL.`);
        return;
      }
    }

    const resolvedTier = isCustomMode
      ? getTierForAmountSol(solVal)
      : selectedGift;
    const lamports = Math.round(solVal * 1_000_000_000);
    await onSendTip(lamports, solVal, resolvedTier.id, trimmedName, trimmedMsg);
  };

  const displayError = localError || externalError;
  const parsedAmount = parseFloat(customAmount);
  const validAmount = !isNaN(parsedAmount) && parsedAmount >= 0.001;
  const effectiveAlertTier = validAmount
    ? isCustomMode
      ? getTierForAmountSol(parsedAmount)
      : selectedGift
    : selectedGift;
  const usdSuffix =
    solUsdPrice && !isNaN(parsedAmount) && parsedAmount > 0
      ? `(≈ $${(parsedAmount * solUsdPrice).toFixed(2)}) `
      : "";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl bg-[#13141F] border border-white/5 p-5 sm:p-7 space-y-5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-bold text-white">
          Send a tip
        </h2>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-zinc-400">
          <GiftIcon tier={effectiveAlertTier.id} size="sm" withBadge={false} />
          <span>{effectiveAlertTier.name} Alert</span>
        </span>
      </div>

      {/* 6 Upgraded Preset Gift Tiers + Custom Tip Option */}
      <MicroTierSelector
        selectedTier={selectedGift}
        isCustomSelected={isCustomMode}
        onSelectTier={handleSelectGift}
        onSelectCustom={handleSelectCustom}
        solUsdPrice={solUsdPrice}
      />

      {/* Quick Manual SOL & USD Presets (always easy to tap, highlighted in Custom mode) */}
      <div
        className={`rounded-2xl p-3.5 sm:p-4 border transition-colors space-y-3 ${
          isCustomMode
            ? "bg-[#0D111C] border-[#14F195]/40"
            : "bg-[#090A0F]/80 border-white/5"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#14F195]" />
            <span>Write custom amount or pick a quick preset</span>
          </span>
          {solUsdPrice && !isNaN(parsedAmount) && parsedAmount > 0 && (
            <span className="text-[11px] font-mono text-[#14F195]">
              ≈ ${(parsedAmount * solUsdPrice).toFixed(2)} USD
            </span>
          )}
        </div>

        {/* Manual SOL Input with inline unit & quick clear */}
        <div className="flex items-center bg-[#090A0F] border border-white/15 focus-within:border-[#14F195] rounded-xl px-3.5 py-2.5 transition-colors">
          <input
            ref={customInputRef}
            type="number"
            step="0.001"
            min="0.001"
            value={customAmount}
            onChange={(e) => handleManualAmountChange(e.target.value)}
            placeholder="0.050"
            className="w-full min-w-0 bg-transparent text-sm sm:text-base text-white font-mono font-bold tabular-nums focus:outline-none"
          />
          <span className="ml-2 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px] font-mono font-bold text-[#14F195] select-none flex-shrink-0">
            SOL
          </span>
        </div>

        {/* Quick SOL & Live USD Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_CUSTOM_SOL.map((sol) => (
            <button
              key={`sol-${sol}`}
              type="button"
              onClick={() => applyQuickSol(sol)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold border transition-colors ${
                Number(customAmount) === sol
                  ? "bg-[#9945FF]/25 border-[#9945FF] text-white"
                  : "bg-[#13141F] border-white/10 text-zinc-300 hover:border-white/25 hover:text-white"
              }`}
            >
              {sol} SOL
            </button>
          ))}

          {solUsdPrice &&
            QUICK_CUSTOM_USD.map((usd) => (
              <button
                key={`usd-${usd}`}
                type="button"
                onClick={() => applyQuickUsd(usd)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold bg-[#13141F] border border-[#14F195]/25 text-[#14F195] hover:bg-[#14F195]/15 transition-colors"
              >
                ${usd}
              </button>
            ))}
        </div>
      </div>

      {/* Display Name */}
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

      {/* Live Micro-Vote Poll Option (when creator has an active poll) */}
      {activePoll && activePoll.isActive && (() => {
        const totalVotes = activePoll.votesA + activePoll.votesB;
        const pctA = totalVotes > 0 ? Math.round((activePoll.votesA / totalVotes) * 100) : 50;
        const pctB = totalVotes > 0 ? 100 - pctA : 50;
        const minVoteSol = (activePoll.minVoteLamports || 1_000_000) / 1_000_000_000;
        const handleToggleVote = (choice: "A" | "B") => {
          const next = selectedVote === choice ? null : choice;
          setSelectedVote(next);
          if (next) {
            const currentSol = parseFloat(customAmount) || 0;
            if (currentSol < minVoteSol) {
              setIsCustomMode(true);
              setCustomAmount(minVoteSol.toString());
              setSelectedGift(getTierForAmountSol(minVoteSol));
            }
          }
        };
        return (
          <div className="rounded-2xl bg-[#0D111C] border border-[#9945FF]/35 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Vote className="w-3.5 h-3.5 text-[#9945FF]" />
                <span>Live Poll: {activePoll.question}</span>
              </span>
              <span className="font-mono text-zinc-400">min {minVoteSol} SOL</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleToggleVote("A")}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  selectedVote === "A"
                    ? "bg-[#9945FF]/20 border-[#9945FF] text-white"
                    : "bg-[#090A0F] border-white/10 text-zinc-300 hover:border-white/25"
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="truncate">A · {activePoll.optionA}</span>
                  <span className="font-mono text-[#14F195] ml-2">
                    {pctA}% ({activePoll.votesA})
                  </span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleToggleVote("B")}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  selectedVote === "B"
                    ? "bg-[#14F195]/15 border-[#14F195] text-white"
                    : "bg-[#090A0F] border-white/10 text-zinc-300 hover:border-white/25"
                }`}
              >
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="truncate">B · {activePoll.optionB}</span>
                  <span className="font-mono text-[#00F0FF] ml-2">
                    {pctB}% ({activePoll.votesB})
                  </span>
                </div>
              </button>
            </div>
          </div>
        );
      })()}

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
            disabled={isLoading || !isCreatorReady || !validAmount}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#9945FF] to-[#14F195] text-[#090A0F] font-black text-sm tracking-wide transition-all shadow-lg shadow-[#14F195]/20 flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#090A0F]" />
                <span>Sending Tip on Solana Devnet...</span>
              </>
            ) : (
              <span>
                Send {customAmount || "0"} SOL {usdSuffix}with Wallet
              </span>
            )}
          </button>
        )}

        <div className="text-center text-[10px] text-zinc-500 mt-2.5">
          Direct on-chain CPI transfer · Zero platform fees · Min 0.001 SOL
        </div>
      </div>
    </form>
  );
};

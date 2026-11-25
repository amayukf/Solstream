"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { PublicKey } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useSolStreamProgram } from "@/hooks/useSolStreamProgram";
import {
  getStoredCreator,
  saveStoredCreator,
  getStoredTips,
  addStoredTip,
  TipRecord,
} from "@/lib/storage";
import { SolanaLogo } from "@/components/SolanaLogo";
import { TipSuccessModal } from "@/components/tipping/TipSuccessModal";
import { Loader2, AlertCircle, Sparkles, ExternalLink, Flame } from "lucide-react";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

interface GiftOption {
  id: number;
  emoji: string;
  name: string;
  sol: number;
  lamports: number;
}

const GIFTS: GiftOption[] = [
  { id: 0, emoji: "☕", name: "Coffee", sol: 0.005, lamports: 5_000_000 },
  { id: 1, emoji: "🌹", name: "Rose", sol: 0.01, lamports: 10_000_000 },
  { id: 2, emoji: "🔥", name: "Fire", sol: 0.025, lamports: 25_000_000 },
  { id: 3, emoji: "💎", name: "Diamond", sol: 0.05, lamports: 50_000_000 },
  { id: 4, emoji: "🚀", name: "Rocket", sol: 0.1, lamports: 100_000_000 },
  { id: 5, emoji: "👑", name: "Crown", sol: 0.25, lamports: 250_000_000 },
];

export default function FanTippingPage({ params }: { params: { username: string } }) {
  const username = params.username.toLowerCase();
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const { sendTip, getCreatorPda, fetchCreatorAccount } = useSolStreamProgram();

  const [selectedGift, setSelectedGift] = useState<GiftOption>(GIFTS[0]);
  const [displayName, setDisplayName] = useState("");
  const [customAmount, setCustomAmount] = useState("0.005");
  const [message, setMessage] = useState("መልካም ስራ! በርታ!");
  const [walletBalance, setWalletBalance] = useState<string>("0.00");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real tips from localStorage
  const [tips, setTips] = useState<TipRecord[]>([]);
  const [solUsdPrice, setSolUsdPrice] = useState<number | null>(null);

  // Fetch real SOL/USD price from server market feed
  useEffect(() => {
    fetch("/api/prices")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const sol = data?.coins?.find((c: any) => c.symbol === "SOL");
        if (sol?.priceUsd) setSolUsdPrice(sol.priceUsd);
      })
      .catch(() => {});
  }, []);

  // Success modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [successTx, setSuccessTx] = useState({
    signature: "",
    amountSol: 0,
    displayName: "",
    message: "",
  });

  // Creator profile state
  const [creatorProfile, setCreatorProfile] = useState<{
    authority: string | null;
    goalTitle: string;
    goalTargetSol: number;
    goalCurrentSol: number;
    isInitialized: boolean;
  }>({
    authority: null,
    goalTitle: "Stream Goal",
    goalTargetSol: 1.0,
    goalCurrentSol: 0,
    isInitialized: false,
  });

  // Load real tips from localStorage
  const refreshTips = useCallback(() => {
    const realTips = getStoredTips(username);
    setTips(realTips);
  }, [username]);

  useEffect(() => {
    refreshTips();
    // Listen for new tips dispatched in other tabs
    window.addEventListener("storage", refreshTips);
    window.addEventListener("solstream_new_tip", refreshTips as any);
    return () => {
      window.removeEventListener("storage", refreshTips);
      window.removeEventListener("solstream_new_tip", refreshTips as any);
    };
  }, [refreshTips]);

  // Load creator profile from localStorage & check on-chain PDA
  useEffect(() => {
    async function loadCreator() {
      // 1. Check localStorage first
      const stored = getStoredCreator(username);
      let authStr = stored?.authority || null;

      // If user is viewing their own profile and connected
      if (!authStr && publicKey) {
        // Check if current connected wallet has an initialized PDA with this username
        try {
          const pda = getCreatorPda(publicKey);
          const acc = await fetchCreatorAccount(pda);
          if (acc && acc.username?.toLowerCase() === username) {
            authStr = publicKey.toBase58();
          }
        } catch (e) {
          console.log("Not creator PDA:", e);
        }
      }

      if (authStr) {
        try {
          const authPubkey = new PublicKey(authStr);
          const pda = getCreatorPda(authPubkey);
          const acc = await fetchCreatorAccount(pda);
          if (acc) {
            const target = acc.goalTargetLamports ?? acc.goal_target_lamports;
            const current = acc.goalCurrentLamports ?? acc.goal_current_lamports;
            const targetSol = typeof target === "number" ? target / 1_000_000_000 : target?.toNumber ? target.toNumber() / 1_000_000_000 : (stored ? stored.goalTargetLamports / 1_000_000_000 : 1.0);
            const currentSol = typeof current === "number" ? current / 1_000_000_000 : current?.toNumber ? current.toNumber() / 1_000_000_000 : 0;

            setCreatorProfile({
              authority: authStr,
              goalTitle: acc.goalTitle || acc.goal_title || stored?.goalTitle || "Stream Goal",
              goalTargetSol: targetSol,
              goalCurrentSol: currentSol,
              isInitialized: true,
            });
            return;
          }
        } catch (e) {
          console.log("Account check finished:", e);
        }

        // If stored has authority, it's claimed and initialized
        if (stored) {
          setCreatorProfile({
            authority: authStr,
            goalTitle: stored.goalTitle || "Stream Goal",
            goalTargetSol: stored.goalTargetLamports / 1_000_000_000,
            goalCurrentSol: (stored.goalCurrentLamports || 0) / 1_000_000_000,
            isInitialized: true,
          });
          return;
        }
      }

      // Not initialized on-chain yet
      setCreatorProfile({
        authority: authStr,
        goalTitle: stored?.goalTitle || "Stream Goal",
        goalTargetSol: stored ? stored.goalTargetLamports / 1_000_000_000 : 1.0,
        goalCurrentSol: 0,
        isInitialized: false,
      });
    }

    loadCreator();
  }, [username, publicKey, getCreatorPda, fetchCreatorAccount]);

  // Load wallet balance
  useEffect(() => {
    async function loadBalance() {
      if (publicKey) {
        try {
          const bal = await connection.getBalance(publicKey);
          setWalletBalance((bal / 1_000_000_000).toFixed(3));
        } catch (e) {
          console.log("Could not load balance:", e);
        }
      }
    }
    loadBalance();
  }, [publicKey, connection]);

  const shortWallet = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : null;

  const handleSelectGift = (gift: GiftOption) => {
    setSelectedGift(gift);
    setCustomAmount(gift.sol.toString());
  };

  const handleSendTip = async () => {
    setError(null);
    if (!connected || !publicKey) {
      setError("Please connect your Phantom wallet first.");
      return;
    }

    if (!creatorProfile.isInitialized || !creatorProfile.authority) {
      setError(
        `Creator @${username} has not initialized their on-chain account on Devnet yet. Please initialize the profile first via the button below.`
      );
      return;
    }

    const solVal = parseFloat(customAmount);
    if (isNaN(solVal) || solVal < 0.001) {
      setError("Minimum tip is 0.001 SOL to prevent dust/spam.");
      return;
    }

    const trimmedMsg = message.trim() || "መልካም ስራ!";
    const trimmedName = displayName.trim() || "Anonymous";
    if (new TextEncoder().encode(trimmedMsg).length > 300) {
      setError("Message exceeds the 300-byte on-chain UTF-8 limit.");
      return;
    }
    if (new TextEncoder().encode(trimmedName).length > 96) {
      setError("Display name exceeds the 96-byte on-chain UTF-8 limit.");
      return;
    }

    setIsLoading(true);
    try {
      const lamports = Math.round(solVal * 1_000_000_000);
      const creatorAuth = new PublicKey(creatorProfile.authority);

      const { tx } = await sendTip(
        lamports,
        selectedGift.id,
        trimmedName,
        trimmedMsg,
        creatorAuth
      );

      // Record REAL tip in localStorage
      const newTip: TipRecord = {
        signature: tx,
        donor: publicKey.toBase58(),
        displayName: trimmedName,
        amountLamports: lamports,
        tier: selectedGift.id,
        message: trimmedMsg,
        timestamp: Date.now(),
      };

      addStoredTip(username, newTip);
      refreshTips();

      // Update goal state
      setCreatorProfile((prev) => ({
        ...prev,
        goalCurrentSol: prev.goalCurrentSol + solVal,
      }));

      // Open Confetti success modal
      setSuccessTx({
        signature: tx,
        amountSol: solVal,
        displayName: displayName.trim() || "Anonymous",
        message: message.trim(),
      });
      setModalOpen(true);
    } catch (err: any) {
      console.error("Tip failed:", err);
      setError(err?.message || "Transaction failed on Solana Devnet.");
    } finally {
      setIsLoading(false);
    }
  };

  const goalPercentage = Math.min(
    Math.round((creatorProfile.goalCurrentSol / (creatorProfile.goalTargetSol || 1)) * 100),
    100
  );

  return (
    <div className="min-h-screen bg-[#0B0C10] text-[#E0E2EC] pb-24">
      {/* Top Navbar */}
      <header className="w-full max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <SolanaLogo className="w-6 h-5" />
            <span className="text-xl font-bold tracking-tight text-white">
              SolStream
            </span>
          </Link>
          <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 text-[10px] font-bold tracking-wider uppercase">
            LIVE
          </span>
        </div>

        <div>
          {connected ? (
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#13141F] border border-white/10 text-xs font-mono text-zinc-300">
              <span className="w-2 h-2 rounded-full bg-[#14F195]" />
              <span>
                {shortWallet} · {walletBalance} SOL
              </span>
            </div>
          ) : (
            <WalletMultiButton className="!bg-[#1D1B2E] !text-white !font-semibold !text-xs !rounded-xl !h-10 !px-4 !border !border-white/10" />
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 pt-4">
        {/* Uninitialized Warning Banner if profile not on-chain */}
        {!creatorProfile.isInitialized && (
          <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <span>
                <strong>Profile Not Initialized on Devnet:</strong> @{username} must be created on-chain before it can receive tips.
              </span>
            </div>
            <Link
              href={`/claim?handle=${username}`}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs tracking-wide transition-colors flex-shrink-0"
            >
              Initialize @{username} on Solana
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* COLUMN 1: CREATOR PROFILE CARD (3.5 cols) */}
          <div className="lg:col-span-3">
            <div className="rounded-3xl bg-[#13141F] border border-white/5 p-6 text-center space-y-4">
              {/* Circular Avatar */}
              <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-[#9945FF] via-[#00F0FF] to-[#14F195] p-1 mx-auto">
                <div className="w-full h-full rounded-full bg-[#13141F] flex items-center justify-center text-2xl font-black text-white uppercase">
                  {username.slice(0, 1)}
                </div>
              </div>

              <div>
                <h1 className="text-lg font-bold text-white">@{username}</h1>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  Streaming live on Solana. Tips go straight to my wallet with zero platform cuts.
                </p>
              </div>

              {/* Goal Container inside profile */}
              <div className="pt-4 border-t border-white/5 text-left space-y-2">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-white">{creatorProfile.goalTitle}</span>
                  <span className="text-[#14F195] font-mono">
                    {creatorProfile.goalCurrentSol.toFixed(3)} / {creatorProfile.goalTargetSol.toFixed(1)} SOL
                  </span>
                </div>

                <div className="w-full h-2.5 bg-black/60 rounded-full overflow-hidden p-0.5 border border-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#9945FF] to-[#14F195] transition-all duration-500"
                    style={{ width: `${Math.max(goalPercentage, 3)}%` }}
                  />
                </div>

                <p className="text-[10px] text-zinc-500 leading-tight">
                  Progress is verified directly from the on-chain account.
                </p>
              </div>
            </div>
          </div>

          {/* COLUMN 2: SEND A TIP CARD (5.5 cols) */}
          <div className="lg:col-span-6">
            <div className="rounded-3xl bg-[#13141F] border border-white/5 p-7 space-y-5">
              <h2 className="text-base font-bold text-white">Send a tip</h2>

              {/* 6 Gifts Grid */}
              <div className="grid grid-cols-3 gap-3">
                {GIFTS.map((g) => {
                  const isSelected = selectedGift.id === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => handleSelectGift(g)}
                      className={`p-3.5 rounded-2xl text-left transition-all ${
                        isSelected
                          ? "bg-[#1E1838] border-2 border-[#9945FF] shadow-lg shadow-[#9945FF]/20"
                          : "bg-[#090A0F] border border-white/5 hover:border-white/10"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{g.emoji}</span>
                        <span className="text-xs font-bold text-white">
                          {g.name}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-zinc-400">
                        {g.sol} SOL
                      </div>
                    </button>
                  );
                })}
              </div>

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
                    placeholder="e.g. Abebe"
                    maxLength={32}
                    className="w-full bg-[#090A0F] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-[#9945FF]"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] text-zinc-400 font-medium">
                      Custom amount (SOL)
                    </label>
                    {solUsdPrice && !isNaN(parseFloat(customAmount)) && (
                      <span className="text-[11px] font-mono text-[#14F195]">
                        ≈ ${(parseFloat(customAmount) * solUsdPrice).toFixed(2)} USD
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="w-full bg-[#090A0F] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-[#9945FF]"
                  />
                </div>
              </div>

              {/* Message Field */}
              <div>
                <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5 font-medium">
                  <span>Stream alert message (read live by AI)</span>
                  <span className="font-mono">{message.length} / 100</span>
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
                  {[
                    "መልካም ስራ! በርታ!",
                    "Keep shining! 🔥",
                    "Coffee on me ☕",
                    "LFG! 🚀",
                  ].map((preset) => (
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
              {error && (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Action Button */}
              <div>
                {!connected ? (
                  <div className="w-full flex justify-center">
                    <WalletMultiButton className="!w-full !justify-center !h-12 !rounded-2xl !bg-gradient-to-r !from-[#9945FF] !to-[#14F195] !text-[#090A0F] !font-black !text-sm" />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleSendTip}
                    disabled={isLoading || !creatorProfile.isInitialized}
                    className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#9945FF] to-[#14F195] text-[#090A0F] font-black text-sm tracking-wide transition-all shadow-lg shadow-[#14F195]/20 flex items-center justify-center gap-2 hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-[#090A0F]" />
                        <span>Sending Tip on Solana Devnet...</span>
                      </>
                    ) : (
                      <span>
                        Send {customAmount} SOL{" "}
                        {solUsdPrice && !isNaN(parseFloat(customAmount))
                          ? `(≈ $${(parseFloat(customAmount) * solUsdPrice).toFixed(2)}) `
                          : ""}
                        with Phantom
                      </span>
                    )}
                  </button>
                )}

                <div className="text-center text-[10px] text-zinc-500 mt-2.5">
                  Direct on-chain CPI transfer · Zero platform fees
                </div>
              </div>
            </div>
          </div>

          {/* COLUMN 3: REAL TOP SUPPORTERS (3 cols) */}
          <div className="lg:col-span-3">
            <div className="rounded-3xl bg-[#13141F] border border-white/5 p-6 space-y-4">
              <h2 className="text-sm font-bold text-white">Top supporters</h2>

              {tips.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500 space-y-2">
                  <Flame className="w-6 h-6 mx-auto text-zinc-600" />
                  <p>No tips received yet.</p>
                  <p className="text-[11px] text-zinc-600">
                    Be the first supporter to tip @{username}!
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {[...tips]
                    .sort((a, b) => b.amountLamports - a.amountLamports)
                    .slice(0, 5)
                    .map((t, idx) => {
                    const medalBg =
                      idx === 0
                        ? "bg-[#FFD700] text-black"
                        : idx === 1
                        ? "bg-[#E5E7EB] text-black"
                        : idx === 2
                        ? "bg-[#CD7F32] text-black"
                        : "bg-[#1A1B29] text-zinc-400";
                    const shortSig = `${t.signature.slice(0, 4)}...${t.signature.slice(-4)}`;
                    const solscanUrl = `https://solscan.io/tx/${t.signature}?cluster=devnet`;
                    const solAmt = (t.amountLamports / 1_000_000_000).toFixed(3);

                    return (
                      <div
                        key={t.signature}
                        className="flex items-center justify-between p-3 rounded-2xl bg-[#090A0F] border border-white/5"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-6 h-6 rounded-full font-black text-xs flex items-center justify-center ${medalBg}`}
                          >
                            {idx + 1}
                          </div>
                          <div>
                            <div className="text-xs font-bold text-white">
                              {t.displayName}
                            </div>
                            <a
                              href={solscanUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-[#9945FF] hover:underline font-mono"
                            >
                              tx: {shortSig}
                            </a>
                          </div>
                        </div>
                        <div className="text-xs font-mono font-bold text-white">
                          {solAmt} SOL
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="text-[10px] text-zinc-500 leading-tight pt-2 border-t border-white/5">
                Every tip links to verified on-chain proof on Solscan.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Real Success Modal */}
      <TipSuccessModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        signature={successTx.signature}
        amountSol={successTx.amountSol}
        displayName={successTx.displayName}
        message={successTx.message}
        username={username}
      />
    </div>
  );
}

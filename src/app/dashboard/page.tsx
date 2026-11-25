"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSolStreamProgram } from "@/hooks/useSolStreamProgram";
import {
  getStoredCreator,
  getCreatorByWallet,
  getActiveHandle,
  saveStoredCreator,
  getStoredTips,
  TipRecord,
} from "@/lib/storage";
import { SolanaLogo } from "@/components/SolanaLogo";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { QRCodeSVG } from "qrcode.react";
import {
  Copy,
  Check,
  ExternalLink,
  Loader2,
  AlertCircle,
  Inbox,
  Sparkles,
  QrCode,
  X,
} from "lucide-react";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

const VOICES = [
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni" },
];

export default function CreatorDashboardPage() {
  const { connected, publicKey } = useWallet();
  const {
    getCreatorPda,
    fetchCreatorAccount,
    fetchHandleRegistry,
    initializeCreator,
    registerExistingHandle,
    updateGoal,
    updateVoice,
  } = useSolStreamProgram();

  const [username, setUsername] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0].id);
  const [isCopied, setIsCopied] = useState(false);
  const [isBioCopied, setIsBioCopied] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [isUpdatingGoal, setIsUpdatingGoal] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isHandleLocked, setIsHandleLocked] = useState<boolean | null>(null);
  const [isLockingHandle, setIsLockingHandle] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isCheckingAccount, setIsCheckingAccount] = useState(true);

  // Goal & stats
  const [goalTitle, setGoalTitle] = useState("Mic upgrade");
  const [goalTargetSol, setGoalTargetSol] = useState("3.0");
  const [currentGoalSol, setCurrentGoalSol] = useState(0);
  const [totalTipsCount, setTotalTipsCount] = useState(0);
  const [totalVolumeSol, setTotalVolumeSol] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);

  // Real tips from localStorage + Solana Devnet API
  const [tips, setTips] = useState<TipRecord[]>([]);

  // Refresh real tips from localStorage + merge on-chain Devnet tips (totals always follow creator chain stats)
  const refreshDashboardTips = useCallback(async (uname: string) => {
    if (!uname) return;
    const localTips = getStoredTips(uname);
    let merged = localTips;
    let hasAuthoritativeCreatorStats = false;

    try {
      const res = await fetch(`/api/creators/${encodeURIComponent(uname)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.creator) {
          setCurrentGoalSol(
            (Number(data.creator.goalCurrentLamports) || 0) / 1_000_000_000
          );
          if (
            data.creator.totalTips !== undefined &&
            data.creator.totalVolume !== undefined
          ) {
            hasAuthoritativeCreatorStats = true;
            setTotalTipsCount(Number(data.creator.totalTips) || 0);
            setTotalVolumeSol(
              (Number(data.creator.totalVolume) || 0) / 1_000_000_000
            );
          }
        }
        const chainTips: TipRecord[] = (data?.tips || []).map((t: any) => ({
          signature: t.signature,
          donor: t.donor,
          displayName: t.displayName || "Anonymous",
          amountLamports: Number(t.amountLamports) || 0,
          tier: typeof t.tier === "number" ? t.tier : 0,
          message: t.message || "",
          timestamp: Number(t.timestamp) || Date.now(),
        }));
        const map = new Map<string, TipRecord>();
        for (const t of [...localTips, ...chainTips]) {
          if (!map.has(t.signature)) map.set(t.signature, t);
        }
        merged = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
      }
    } catch {
      // Offline / transient fallback to localStorage
    }

    setTips(merged);
    if (!hasAuthoritativeCreatorStats) {
      const stored = getStoredCreator(uname);
      if (
        stored?.totalTips !== undefined &&
        stored?.totalVolume !== undefined
      ) {
        setTotalTipsCount(stored.totalTips);
        setTotalVolumeSol(stored.totalVolume / 1_000_000_000);
      } else {
        const totalLamports = merged.reduce((acc, t) => acc + t.amountLamports, 0);
        setTotalVolumeSol(totalLamports / 1_000_000_000);
        setTotalTipsCount(merged.length);
      }
    }
  }, []);

  // Dynamically find creator profile by wallet address & on-chain PDA
  useEffect(() => {
    async function loadWalletCreator() {
      setIsCheckingAccount(true);

      if (!publicKey) {
        // Fallback to active handle if any
        const active = getActiveHandle();
        if (active) {
          const stored = getStoredCreator(active);
          if (stored) {
            setUsername(stored.username);
            setGoalTitle(stored.goalTitle);
            setGoalTargetSol((stored.goalTargetLamports / 1_000_000_000).toString());
            setSelectedVoice(stored.voiceId);
            refreshDashboardTips(stored.username);
          }
        } else {
          setUsername(null);
        }
        setIsCheckingAccount(false);
        return;
      }

      const walletStr = publicKey.toBase58();

      // 1. Check on-chain PDA first (ultimate source of truth)
      try {
        const pda = getCreatorPda(publicKey);
        const acc = await fetchCreatorAccount(pda);
        if (acc) {
          const walletCreator = getCreatorByWallet(walletStr);
          const active = getActiveHandle();
          const activeCreator = active ? getStoredCreator(active) : null;
          const ownedActiveCreator =
            activeCreator &&
            activeCreator.authority.toLowerCase() === walletStr.toLowerCase()
              ? activeCreator
              : null;
          const stored = walletCreator || ownedActiveCreator;
          const onChainHandle = (acc.username || stored?.username || "").toLowerCase();

          if (onChainHandle) {
            setUsername(onChainHandle);
            setIsInitialized(true);

            const toNum = (raw: any, fallback: number) =>
              raw !== undefined && raw !== null
                ? typeof raw === "number"
                  ? raw
                  : raw.toNumber
                  ? raw.toNumber()
                  : Number(raw)
                : fallback;

            const targetVal = toNum(
              acc.goalTargetLamports ?? acc.goal_target_lamports,
              stored?.goalTargetLamports || 3_000_000_000
            );
            const currentVal = toNum(
              acc.goalCurrentLamports ?? acc.goal_current_lamports,
              stored?.goalCurrentLamports || 0
            );
            const chainTotalTips = toNum(
              acc.totalTips ?? acc.total_tips,
              stored?.totalTips || 0
            );
            const chainTotalVolume = toNum(
              acc.totalVolume ?? acc.total_volume,
              stored?.totalVolume || 0
            );

            setGoalTitle(acc.goalTitle || acc.goal_title || stored?.goalTitle || "Stream Goal");
            setGoalTargetSol((targetVal / 1_000_000_000).toString());
            setCurrentGoalSol(currentVal / 1_000_000_000);
            setTotalTipsCount(chainTotalTips);
            setTotalVolumeSol(chainTotalVolume / 1_000_000_000);
            setSelectedVoice(acc.voiceId || acc.voice_id || stored?.voiceId || VOICES[0].id);

            saveStoredCreator(
              {
                username: onChainHandle,
                authority: walletStr,
                voiceId: acc.voiceId || acc.voice_id || stored?.voiceId || VOICES[0].id,
                goalTitle: acc.goalTitle || acc.goal_title || stored?.goalTitle || "Stream Goal",
                goalTargetLamports: targetVal,
                goalCurrentLamports: currentVal,
                totalTips: chainTotalTips,
                totalVolume: chainTotalVolume,
                createdAt: Date.now(),
              },
              walletStr
            );

            refreshDashboardTips(onChainHandle);
            setIsCheckingAccount(false);
            return;
          }
        }
      } catch (e) {
        console.log("On-chain check finished:", e);
      }

      // 2. Check localStorage for a creator registered to this specific wallet
      const walletCreator = getCreatorByWallet(walletStr);
      if (walletCreator) {
        setUsername(walletCreator.username);
        setGoalTitle(walletCreator.goalTitle);
        setGoalTargetSol((walletCreator.goalTargetLamports / 1_000_000_000).toString());
        setSelectedVoice(walletCreator.voiceId);
        setIsInitialized(false); // needs on-chain initialization
        refreshDashboardTips(walletCreator.username);
      } else {
        // Check active handle if created in this session
        const active = getActiveHandle();
        const stored = active ? getStoredCreator(active) : null;
        if (stored && stored.authority.toLowerCase() === walletStr.toLowerCase()) {
          setUsername(stored.username);
          setGoalTitle(stored.goalTitle);
          setGoalTargetSol((stored.goalTargetLamports / 1_000_000_000).toString());
          setSelectedVoice(stored.voiceId);
          setIsInitialized(false);
          refreshDashboardTips(stored.username);
        } else {
          setUsername(null);
          setIsInitialized(false);
        }
      }

      setIsCheckingAccount(false);
    }

    loadWalletCreator();
  }, [publicKey, getCreatorPda, fetchCreatorAccount, refreshDashboardTips]);

  // Real-time Supabase WebSocket + cross-tab listener + fallback polling
  useEffect(() => {
    if (!username) return;
    const handleSync = () => refreshDashboardTips(username);
    window.addEventListener("storage", handleSync);
    window.addEventListener("solstream_new_tip", handleSync as any);

    const sb = getSupabaseClient();
    let channel: any = null;
    if (sb) {
      channel = sb
        .channel(`dashboard-tips-${username}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "tips",
            filter: `username=eq.${username}`,
          },
          () => handleSync()
        )
        .subscribe();
    }

    const poll = setInterval(handleSync, 8000);
    return () => {
      clearInterval(poll);
      if (sb && channel) sb.removeChannel(channel);
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("solstream_new_tip", handleSync as any);
    };
  }, [username, refreshDashboardTips]);

  const shortWallet = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : null;

  const tipPageUrl = typeof window !== "undefined" && username
    ? `${window.location.origin}/${username}`
    : username
    ? `https://solstream.app/${username}`
    : "";

  const overlayUrl = typeof window !== "undefined" && username
    ? `${window.location.origin}/overlay/${username}`
    : username
    ? `https://solstream.app/overlay/${username}`
    : "";

  const handleCopyTipLink = () => {
    if (!tipPageUrl) return;
    navigator.clipboard.writeText(tipPageUrl);
    setIsBioCopied(true);
    setTimeout(() => setIsBioCopied(false), 2500);
  };

  const handleCopyOverlay = () => {
    if (!overlayUrl) return;
    navigator.clipboard.writeText(overlayUrl);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  };

  const handleInitOnChain = async () => {
    if (!connected || !publicKey || !username) return;
    setIsInitializing(true);
    setStatusMessage(null);
    try {
      const lamports = Math.round(parseFloat(goalTargetSol) * 1_000_000_000);
      await initializeCreator(username, selectedVoice, lamports, goalTitle);
      setIsInitialized(true);
      saveStoredCreator(
        {
          username,
          authority: publicKey.toBase58(),
          voiceId: selectedVoice,
          goalTitle,
          goalTargetLamports: lamports,
          goalCurrentLamports: 0,
          createdAt: Date.now(),
        },
        publicKey.toBase58()
      );
      await fetch("/api/creators/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: publicKey.toBase58() }),
      }).catch(() => {});
      setStatusMessage(`✅ @${username} successfully initialized on Solana Devnet!`);
    } catch (err: any) {
      console.error(err);
      const errMsg = err?.message || String(err);
      if (
        errMsg.includes("already in use") ||
        errMsg.includes("0x0") ||
        errMsg.includes("AccountAlreadyInUse")
      ) {
        setIsInitialized(true);
        await fetch("/api/creators/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress: publicKey.toBase58() }),
        }).catch(() => {});
        setStatusMessage(`✅ @${username} is already active on Solana Devnet!`);
      } else {
        setStatusMessage(`❌ Error initializing: ${errMsg}`);
      }
    } finally {
      setIsInitializing(false);
    }
  };

  const handleUpdateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !publicKey || !username) return;
    setStatusMessage(null);

    const cleanGoalTitle = goalTitle.trim() || "Stream Goal";
    if (new TextEncoder().encode(cleanGoalTitle).length > 64) {
      setStatusMessage("❌ Goal title exceeds the 64-byte on-chain UTF-8 limit.");
      return;
    }
    const targetNum = parseFloat(goalTargetSol);
    if (isNaN(targetNum) || targetNum < 0.01) {
      setStatusMessage("❌ Goal target must be at least 0.01 SOL.");
      return;
    }

    setIsUpdatingGoal(true);
    try {
      const lamports = Math.round(targetNum * 1_000_000_000);
      await updateGoal(lamports, cleanGoalTitle);
      setCurrentGoalSol(0);
      saveStoredCreator(
        {
          username,
          authority: publicKey.toBase58(),
          voiceId: selectedVoice,
          goalTitle: cleanGoalTitle,
          goalTargetLamports: lamports,
          goalCurrentLamports: 0,
          createdAt: Date.now(),
        },
        publicKey.toBase58()
      );
      await fetch("/api/creators/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: publicKey.toBase58() }),
      }).catch(() => {});
      setStatusMessage("✅ Goal updated on-chain!");
    } catch (err: any) {
      setStatusMessage(`❌ Error: ${err?.message || "Failed to update goal."}`);
    } finally {
      setIsUpdatingGoal(false);
    }
  };

  const handleSelectVoice = async (voiceId: string) => {
    setSelectedVoice(voiceId);
    if (username && publicKey) {
      saveStoredCreator(
        {
          username,
          authority: publicKey.toBase58(),
          voiceId,
          goalTitle,
          goalTargetLamports: Math.round((parseFloat(goalTargetSol) || 3.0) * 1_000_000_000),
          goalCurrentLamports: Math.round(currentGoalSol * 1_000_000_000),
          createdAt: Date.now(),
        },
        publicKey.toBase58()
      );
    }
    if (!connected || !isInitialized || !publicKey) return;
    try {
      await updateVoice(voiceId);
      await fetch("/api/creators/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: publicKey.toBase58() }),
      }).catch(() => {});
      setStatusMessage("✅ Voice persona updated on-chain!");
    } catch (e) {
      console.log("Voice updated locally:", e);
    }
  };

  useEffect(() => {
    if (!connected || !isInitialized || !username) {
      setIsHandleLocked(null);
      return;
    }
    let cancelled = false;
    fetchHandleRegistry(username)
      .then((reg) => {
        if (!cancelled) setIsHandleLocked(Boolean(reg));
      })
      .catch(() => {
        if (!cancelled) setIsHandleLocked(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, isInitialized, username, fetchHandleRegistry]);

  const handleLockExistingHandle = async () => {
    if (!connected || !publicKey || !username) return;
    setIsLockingHandle(true);
    setStatusMessage(null);
    try {
      const { tx } = await registerExistingHandle(username);
      setIsHandleLocked(true);
      setStatusMessage(
        `✅ Handle @${username} locked on-chain! Tx: ${tx.slice(0, 12)}...`
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to lock handle on-chain.";
      setStatusMessage(`❌ ${msg}`);
    } finally {
      setIsLockingHandle(false);
    }
  };

  const goalPercentage = Math.min(
    Math.round((currentGoalSol / (parseFloat(goalTargetSol) || 1)) * 100),
    100
  );

  return (
    <div className="min-h-screen bg-[#0B0C10] text-[#E0E2EC] pb-24 overflow-x-clip">
      {/* Top Bar */}
      <header className="relative z-50 w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <Link href="/" className="flex items-center gap-2">
            <SolanaLogo className="w-6 h-5" />
            <span className="text-lg sm:text-xl font-bold tracking-tight text-white">
              Creator Studio
            </span>
          </Link>
          {username && (
            <span className="px-2.5 py-0.5 rounded-full bg-[#13141F] border border-white/10 text-xs font-semibold text-[#14F195]">
              @{username}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-4">
          {username && (
            <Link
              href={`/${username}`}
              target="_blank"
              className="px-3 sm:px-4 py-2 rounded-xl bg-[#13141F] hover:bg-[#1A1B29] text-xs font-semibold text-zinc-300 border border-white/10 transition-colors whitespace-nowrap"
            >
              View public tip page
            </Link>
          )}

          {connected ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#13141F] border border-white/10 text-xs font-mono text-zinc-300">
              <span className="w-2 h-2 rounded-full bg-[#14F195]" />
              <span>{shortWallet}</span>
            </div>
          ) : (
            <WalletMultiButton className="!bg-[#1D1B2E] !text-white !font-semibold !text-xs !rounded-xl !h-10 !px-4 !border !border-white/10" />
          )}
        </div>
      </header>

      {/* Main Studio Body */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 space-y-6">
        {/* Status notification */}
        {statusMessage && (
          <div className="p-3.5 rounded-2xl bg-[#13141F] border border-white/10 text-xs text-white">
            {statusMessage}
          </div>
        )}

        {/* If user hasn't claimed a handle yet */}
        {!isCheckingAccount && !username && (
          <div className="p-8 rounded-3xl bg-[#13141F] border border-white/10 text-center space-y-4 max-w-2xl mx-auto shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-[#9945FF]/10 text-[#9945FF] flex items-center justify-center mx-auto border border-[#9945FF]/20">
              <Sparkles className="w-7 h-7" />
            </div>
            <h2 className="text-2xl font-black text-white">
              Create Your Creator Profile
            </h2>
            <p className="text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
              You haven&apos;t claimed a creator handle for your wallet yet. Claim your custom username to start receiving direct on-chain SOL tips with OBS stream alerts.
            </p>
            <div className="pt-2">
              <Link
                href="/claim"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#14F195] hover:bg-[#12DB87] text-[#090A0F] font-black text-sm tracking-wide shadow-lg shadow-[#14F195]/20 transition-all"
              >
                <span>Claim Your Handle on Solana</span>
              </Link>
            </div>
          </div>
        )}

        {/* Warning if wallet has handle in localStorage but not yet on-chain */}
        {username && connected && !isInitialized && (
          <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <span>
                <strong>Account Not Initialized On-Chain:</strong> Your handle <strong>@{username}</strong> is ready, but your wallet needs to sign one transaction on Devnet so viewers can tip directly into your wallet.
              </span>
            </div>
            <button
              onClick={handleInitOnChain}
              disabled={isInitializing}
              className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-black text-xs tracking-wide transition-all shadow-lg flex-shrink-0 flex items-center gap-2 disabled:opacity-50"
            >
              {isInitializing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-black" />
                  <span>Signing on Solana...</span>
                </>
              ) : (
                <span>Initialize @{username} on Solana</span>
              )}
            </button>
          </div>
        )}

        {/* Legacy handle backfill banner (when HandleRegistry PDA is missing) */}
        {username && connected && isInitialized && isHandleLocked === false && (
          <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <span>
                <strong>Legacy Handle Not Locked On-Chain:</strong> Your handle{" "}
                <strong>@{username}</strong> was created before the HandleRegistry
                upgrade. Lock it once on Devnet so nobody else can claim{" "}
                <strong>@{username}</strong>.
              </span>
            </div>
            <button
              onClick={handleLockExistingHandle}
              disabled={isLockingHandle}
              className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-black text-xs tracking-wide transition-all shadow-lg flex-shrink-0 flex items-center gap-2 disabled:opacity-50"
            >
              {isLockingHandle ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-black" />
                  <span>Locking handle...</span>
                </>
              ) : (
                <span>Lock @{username} On-Chain</span>
              )}
            </button>
          </div>
        )}

        {/* Dashboard Content when username exists */}
        {username && (
          <>
            {/* ROW 1: PUBLIC BIO TIP LINK & OBS BROWSER SOURCE URL */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Public Stream Bio Tip Link */}
              <div className="w-full rounded-2xl bg-[#13141F] border border-[#14F195]/40 p-5 flex flex-col justify-between gap-4 shadow-xl">
                <div className="space-y-1">
                  <div className="text-xs font-black uppercase tracking-wider text-[#14F195]">
                    YOUR STREAM BIO TIP LINK
                  </div>
                  <p className="text-xs text-zinc-400">
                    Paste in your Twitch, YouTube, or TikTok bio. Fans just connect any wallet and tip — zero signup required.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                  <div className="w-full sm:flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-white truncate select-all">
                    {tipPageUrl}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={handleCopyTipLink}
                      className="flex-1 sm:flex-initial justify-center px-4 py-2.5 rounded-xl bg-[#14F195] hover:bg-[#12DB87] text-[#090A0F] font-black text-xs tracking-wide transition-all shadow-lg shadow-[#14F195]/20 flex items-center gap-1.5 flex-shrink-0"
                    >
                      {isBioCopied ? (
                        <>
                          <Check className="w-4 h-4 text-[#090A0F]" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Link</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowQrModal(true)}
                      className="p-2.5 rounded-xl bg-black/40 hover:bg-black/60 text-zinc-300 hover:text-[#14F195] transition-colors flex-shrink-0 border border-white/10"
                      title="Show scannable tip QR code"
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                    <Link
                      href={`/${username}`}
                      target="_blank"
                      className="p-2.5 rounded-xl bg-black/40 hover:bg-black/60 text-zinc-400 hover:text-white transition-colors flex-shrink-0"
                      title="Open fan tip page"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              </div>

              {/* OBS Browser Source URL */}
              <div className="w-full rounded-2xl bg-[#13141F] border border-[#9945FF]/40 p-5 flex flex-col justify-between gap-4 shadow-xl">
                <div className="space-y-1">
                  <div className="text-xs font-black uppercase tracking-wider text-[#9945FF]">
                    YOUR OBS BROWSER SOURCE URL
                  </div>
                  <p className="text-xs text-zinc-400">
                    Add it as a Browser Source (1920 × 1080) and tick &ldquo;Control audio via OBS&rdquo;.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                  <div className="w-full sm:flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-[#14F195] truncate select-all">
                    {overlayUrl}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={handleCopyOverlay}
                      className="flex-1 sm:flex-initial justify-center px-4 py-2.5 rounded-xl bg-[#9945FF] hover:bg-[#8A37FF] text-white font-bold text-xs tracking-wide transition-all shadow-lg shadow-[#9945FF]/20 flex items-center gap-1.5 flex-shrink-0"
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-4 h-4 text-[#14F195]" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <span>Copy URL</span>
                      )}
                    </button>
                    <Link
                      href={`/overlay/${username}?preview=1`}
                      target="_blank"
                      className="p-2.5 rounded-xl bg-black/40 hover:bg-black/60 text-zinc-400 hover:text-white transition-colors flex-shrink-0"
                      title="Preview overlay with test button"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            {/* ROW 2: 3 REAL METRICS CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="rounded-2xl bg-[#13141F] border border-white/5 p-6">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                  TOTAL EARNED
                </div>
                <div className="text-3xl font-black text-white font-mono mb-2">
                  {totalVolumeSol.toFixed(3)} SOL
                </div>
                <p className="text-xs text-zinc-500">
                  Straight to your wallet, no platform cut
                </p>
              </div>

              <div className="rounded-2xl bg-[#13141F] border border-white/5 p-6">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                  TIPS RECEIVED
                </div>
                <div className="text-3xl font-black text-white font-mono mb-2">
                  {totalTipsCount}
                </div>
                <p className="text-xs text-zinc-500">
                  Verified on Solana Devnet
                </p>
              </div>

              <div className="rounded-2xl bg-[#13141F] border border-white/5 p-6">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                  ACTIVE GOAL · {goalTitle.toUpperCase()}
                </div>
                <div className="text-3xl font-black text-[#14F195] font-mono mb-2">
                  {goalPercentage}%
                </div>
                <div className="w-full h-2.5 bg-black/50 rounded-full overflow-hidden p-0.5 border border-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#9945FF] to-[#14F195] transition-all duration-500"
                    style={{ width: `${Math.max(goalPercentage, 3)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* ROW 3: TWO MAIN PANELS */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Stream Goal & Alert Voice (6 cols) */}
              <div className="lg:col-span-6 space-y-6">
                {/* Stream Goal Card */}
                <div className="rounded-2xl bg-[#13141F] border border-white/5 p-5 sm:p-6">
                  <h2 className="text-sm font-bold text-white mb-4">Stream goal</h2>
                  <form onSubmit={handleUpdateGoal} className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <input
                      type="text"
                      value={goalTitle}
                      onChange={(e) => setGoalTitle(e.target.value)}
                      className="w-full sm:flex-1 min-w-0 bg-[#090A0F] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-[#9945FF]"
                    />
                    <div className="flex items-center gap-3">
                      <div className="flex-1 sm:w-28 flex items-center bg-[#090A0F] border border-white/10 rounded-xl px-3 py-2.5 focus-within:border-[#9945FF]">
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          value={goalTargetSol}
                          onChange={(e) => setGoalTargetSol(e.target.value)}
                          className="w-full bg-transparent text-xs text-white font-mono focus:outline-none"
                        />
                        <span className="text-[11px] font-mono text-zinc-500 ml-1 select-none">
                          SOL
                        </span>
                      </div>
                      <button
                        type="submit"
                        disabled={isUpdatingGoal || !connected || !isInitialized}
                        className="px-4 py-2.5 rounded-xl bg-[#14F195] hover:bg-[#12DB87] text-[#090A0F] font-black text-xs leading-none text-center flex-shrink-0 disabled:opacity-50"
                      >
                        {isUpdatingGoal ? (
                          <Loader2 className="w-4 h-4 animate-spin text-[#090A0F]" />
                        ) : (
                          <span>Save on-chain</span>
                        )}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Alert Voice Card */}
                <div className="rounded-2xl bg-[#13141F] border border-white/5 p-5 sm:p-6">
                  <h2 className="text-sm font-bold text-white mb-4">Alert voice</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {VOICES.map((v) => {
                      const isSelected = selectedVoice === v.id;
                      return (
                        <div
                          key={v.id}
                          onClick={() => handleSelectVoice(v.id)}
                          className={`p-3.5 rounded-2xl cursor-pointer transition-all ${
                            isSelected
                              ? "bg-[#1E1838] border-2 border-[#9945FF]"
                              : "bg-[#090A0F] border border-white/10 hover:border-white/20"
                          }`}
                        >
                          <div className="text-xs font-bold text-white mb-2">
                            {v.name}
                          </div>

                          <div className="flex items-end gap-1 h-5 mb-3">
                            <span className="w-1 h-2 bg-[#9945FF] rounded-full" />
                            <span className="w-1 h-4 bg-[#9945FF] rounded-full" />
                            <span className="w-1 h-3 bg-[#9945FF] rounded-full" />
                            <span className="w-1 h-5 bg-[#9945FF] rounded-full" />
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (typeof window !== "undefined" && window.speechSynthesis) {
                                const u = new SpeechSynthesisUtterance(
                                  `Hi, this is ${v.name} reading your stream alerts live on SolStream!`
                                );
                                window.speechSynthesis.speak(u);
                              }
                            }}
                            className="text-[10px] text-zinc-400 hover:text-white"
                          >
                            Preview
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Right Column: Live Tip Ledger (6 cols) */}
              <div className="lg:col-span-6">
                <div className="rounded-2xl bg-[#13141F] border border-white/5 p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-white">Live tip ledger</h2>
                    <div className="flex items-center gap-1.5 text-xs text-[#14F195] font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#14F195] animate-pulse" />
                      <span>Realtime</span>
                    </div>
                  </div>

                  {/* Table with real tips */}
                  {tips.length === 0 ? (
                    <div className="py-12 text-center text-xs text-zinc-500 space-y-2">
                      <Inbox className="w-8 h-8 mx-auto text-zinc-600" />
                      <p>No tips recorded yet.</p>
                      <p className="text-[11px] text-zinc-600">
                        Tips sent on your public page will appear live here with Solscan proofs.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="text-zinc-500 font-bold uppercase tracking-wider border-b border-white/5 pb-2">
                            <th className="py-2">AMOUNT</th>
                            <th className="py-2">FAN</th>
                            <th className="py-2">MESSAGE</th>
                            <th className="py-2 text-right">PROOF</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 text-zinc-300">
                          {tips.map((t) => {
                            const solAmt = (t.amountLamports / 1_000_000_000).toFixed(3);
                            const solscanUrl = `https://solscan.io/tx/${t.signature}?cluster=devnet`;
                            return (
                              <tr key={t.signature}>
                                <td className="py-3 pr-3 font-mono font-bold text-white whitespace-nowrap">
                                  {solAmt} SOL
                                </td>
                                <td className="py-3 pr-3 font-semibold whitespace-nowrap">{t.displayName}</td>
                                <td className="py-3 pr-3 text-zinc-400 italic max-w-[140px] sm:max-w-xs truncate">
                                  &ldquo;{t.message}&rdquo;
                                </td>
                                <td className="py-3 text-right">
                                  <a
                                    href={solscanUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#9945FF] hover:underline"
                                  >
                                    View tx
                                  </a>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Cashing out to birr footer note */}
                  <div className="pt-3 border-t border-white/5 text-[11px] text-zinc-500 leading-relaxed">
                    <strong>Cashing out to birr:</strong> options depend on local
                    rules. Many creators swap to USDC and use a P2P marketplace.
                    Check what is allowed where you live.
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Scannable Stream Tip QR Code Modal */}
      {showQrModal && username && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-[#13141F] border border-white/10 p-7 text-center space-y-5 shadow-2xl relative">
            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
              aria-label="Close QR modal"
            >
              <X className="w-4 h-4" />
            </button>

            <div>
              <div className="text-xs font-black uppercase tracking-wider text-[#14F195] mb-1">
                Scan to Tip @{username}
              </div>
              <p className="text-xs text-zinc-400">
                Put this QR on your stream corner or share with mobile viewers.
              </p>
            </div>

            <div className="bg-white p-4 rounded-2xl inline-block mx-auto shadow-lg">
              <QRCodeSVG
                value={tipPageUrl}
                size={196}
                bgColor="#FFFFFF"
                fgColor="#0B0C10"
                level="M"
              />
            </div>

            <div className="text-[11px] font-mono text-zinc-300 bg-[#090A0F] border border-white/10 rounded-xl px-3 py-2 truncate">
              {tipPageUrl}
            </div>

            <button
              type="button"
              onClick={handleCopyTipLink}
              className="w-full py-3 rounded-xl bg-[#14F195] hover:bg-[#12DB87] text-[#090A0F] font-black text-xs transition-colors"
            >
              {isBioCopied ? "Copied Link!" : "Copy Tip Link"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

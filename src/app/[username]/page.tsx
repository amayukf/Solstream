"use client";

import React, { use, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { PublicKey } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useSolStreamProgram } from "@/hooks/useSolStreamProgram";
import {
  getStoredCreator,
  cacheCreatorProfile,
  getStoredTips,
  addStoredTip,
  getPendingVerifications,
  enqueuePendingVerification,
  removePendingVerification,
  bumpPendingVerificationAttempt,
  TipRecord,
  LeaderboardEntry,
} from "@/lib/storage";
import { SolanaLogo } from "@/components/SolanaLogo";
import { CreatorProfileHeader } from "@/components/tipping/CreatorProfileHeader";
import { StreamGoalCard } from "@/components/tipping/StreamGoalCard";
import { TipForm } from "@/components/tipping/TipForm";
import { TopDonorsLeaderboard } from "@/components/tipping/TopDonorsLeaderboard";
import { TipSuccessModal } from "@/components/tipping/TipSuccessModal";
import { Loader2, AlertCircle } from "lucide-react";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

export default function FanTippingPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username: rawUsername } = use(params);
  const username = rawUsername.toLowerCase();
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const { sendTip, getCreatorPda, fetchCreatorAccount } = useSolStreamProgram();

  const [walletBalance, setWalletBalance] = useState<string>("0.00");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tips, setTips] = useState<TipRecord[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[] | null>(null);
  const [solUsdPrice, setSolUsdPrice] = useState<number | null>(null);
  const flushingVerifyRef = useRef(false);

  // Success modal state with real verification status
  const [modalOpen, setModalOpen] = useState(false);
  const [successTx, setSuccessTx] = useState({
    signature: "",
    amountSol: 0,
    displayName: "",
    message: "",
    serverVerified: false,
    ttsEngine: null as string | null,
  });

  // Creator profile state
  const [isCheckingCreator, setIsCheckingCreator] = useState(true);
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

  const mergeTipLists = useCallback(
    (localTips: TipRecord[], chainTips: TipRecord[]) => {
      const map = new Map<string, TipRecord>();
      for (const t of [...localTips, ...chainTips]) {
        if (!map.has(t.signature)) map.set(t.signature, t);
      }
      return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
    },
    []
  );

  const refreshTips = useCallback(() => {
    const realTips = getStoredTips(username);
    setTips((prev) => mergeTipLists(realTips, prev));
  }, [username, mergeTipLists]);

  useEffect(() => {
    refreshTips();
    window.addEventListener("storage", refreshTips);
    window.addEventListener("solstream_new_tip", refreshTips as any);
    return () => {
      window.removeEventListener("storage", refreshTips);
      window.removeEventListener("solstream_new_tip", refreshTips as any);
    };
  }, [refreshTips]);

  // Load creator profile globally from Solana Devnet API (works for ANY fan without claiming!)
  useEffect(() => {
    let cancelled = false;

    async function loadCreator() {
      setIsCheckingCreator(true);

      // 1. Query Solana Devnet directly via /api/creators/[username]
      try {
        const res = await fetch(
          `/api/creators/${encodeURIComponent(username)}`,
          { cache: "no-store" }
        );
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data?.found && data?.creator) {
            const c = data.creator;
            const chainTips: TipRecord[] = (data.tips || []).map((t: any) => ({
              signature: t.signature,
              donor: t.donor,
              displayName: t.displayName || "Anonymous",
              amountLamports: Number(t.amountLamports) || 0,
              tier: typeof t.tier === "number" ? t.tier : 0,
              message: t.message || "",
              timestamp: Number(t.timestamp) || Date.now(),
            }));

            setCreatorProfile({
              authority: c.authority,
              goalTitle: c.goalTitle || "Stream Goal",
              goalTargetSol:
                (c.goalTargetLamports || 1_000_000_000) / 1_000_000_000,
              goalCurrentSol: (c.goalCurrentLamports || 0) / 1_000_000_000,
              isInitialized: true,
            });

            cacheCreatorProfile({
              username: c.username,
              authority: c.authority,
              voiceId: c.voiceId,
              goalTitle: c.goalTitle,
              goalTargetLamports: c.goalTargetLamports,
              goalCurrentLamports: c.goalCurrentLamports,
              totalTips: c.totalTips,
              totalVolume: c.totalVolume,
              createdAt: Date.now(),
            });

            if (Array.isArray(data.leaderboard)) {
              setLeaderboard(data.leaderboard);
            }

            setTips((prev) =>
              mergeTipLists(getStoredTips(username), mergeTipLists(prev, chainTips))
            );
            setIsCheckingCreator(false);
            return;
          }
        }
      } catch (err) {
        console.log("API creator lookup fallback:", err);
      }

      // 2. Fallback: Check localStorage or connected wallet PDA
      const stored = getStoredCreator(username);
      let authStr = stored?.authority || null;

      if (!authStr && publicKey) {
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
          if (!cancelled && acc) {
            const target = acc.goalTargetLamports ?? acc.goal_target_lamports;
            const current = acc.goalCurrentLamports ?? acc.goal_current_lamports;
            const targetSol =
              typeof target === "number"
                ? target / 1_000_000_000
                : target?.toNumber
                ? target.toNumber() / 1_000_000_000
                : stored
                ? stored.goalTargetLamports / 1_000_000_000
                : 1.0;
            const currentSol =
              typeof current === "number"
                ? current / 1_000_000_000
                : current?.toNumber
                ? current.toNumber() / 1_000_000_000
                : 0;

            setCreatorProfile({
              authority: authStr,
              goalTitle:
                acc.goalTitle || acc.goal_title || stored?.goalTitle || "Stream Goal",
              goalTargetSol: targetSol,
              goalCurrentSol: currentSol,
              isInitialized: true,
            });
            setIsCheckingCreator(false);
            return;
          }
        } catch (e) {
          console.log("Account check finished:", e);
        }

        if (!cancelled && stored) {
          setCreatorProfile({
            authority: authStr,
            goalTitle: stored.goalTitle || "Stream Goal",
            goalTargetSol: stored.goalTargetLamports / 1_000_000_000,
            goalCurrentSol: (stored.goalCurrentLamports || 0) / 1_000_000_000,
            isInitialized: true,
          });
          setIsCheckingCreator(false);
          return;
        }
      }

      if (!cancelled) {
        setCreatorProfile({
          authority: authStr,
          goalTitle: stored?.goalTitle || "Stream Goal",
          goalTargetSol: stored
            ? stored.goalTargetLamports / 1_000_000_000
            : 1.0,
          goalCurrentSol: 0,
          isInitialized: false,
        });
        setIsCheckingCreator(false);
      }
    }

    loadCreator();
    return () => {
      cancelled = true;
    };
  }, [username, publicKey, getCreatorPda, fetchCreatorAccount, mergeTipLists]);

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

  const submitVerifyRequest = useCallback(
    async (sig: string, targetUsername: string): Promise<boolean> => {
      try {
        const res = await fetch("/api/tips/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature: sig, username: targetUsername }),
        });

        if (res.ok) {
          const resData = await res.json().catch(() => null);
          if (resData?.verified || resData?.alreadyProcessed) {
            removePendingVerification(sig);
            setSuccessTx((prev) =>
              prev.signature === sig
                ? {
                    ...prev,
                    serverVerified: true,
                    ttsEngine: resData.ttsEngine || prev.ttsEngine,
                  }
                : prev
            );
            if (targetUsername === username) {
              fetch(`/api/creators/${encodeURIComponent(username)}`, {
                cache: "no-store",
              })
                .then((r) => (r.ok ? r.json() : null))
                .then((freshData) => {
                  if (Array.isArray(freshData?.leaderboard)) {
                    setLeaderboard(freshData.leaderboard);
                  }
                })
                .catch(() => {});
            }
            return true;
          }
        }

        if (res.status === 404) {
          removePendingVerification(sig);
          return false;
        }

        bumpPendingVerificationAttempt(sig);
        return false;
      } catch {
        bumpPendingVerificationAttempt(sig);
        return false;
      }
    },
    [username]
  );

  const flushPendingVerifications = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (flushingVerifyRef.current) return;
    const pending = getPendingVerifications();
    if (pending.length === 0) return;

    flushingVerifyRef.current = true;
    try {
      for (const item of pending) {
        await submitVerifyRequest(item.signature, item.username);
      }
    } finally {
      flushingVerifyRef.current = false;
    }
  }, [submitVerifyRequest]);

  useEffect(() => {
    void flushPendingVerifications();
    window.addEventListener("online", flushPendingVerifications);
    window.addEventListener("focus", flushPendingVerifications);
    const retryTimer = setInterval(() => {
      if (getPendingVerifications().length > 0) {
        void flushPendingVerifications();
      }
    }, 15_000);

    return () => {
      clearInterval(retryTimer);
      window.removeEventListener("online", flushPendingVerifications);
      window.removeEventListener("focus", flushPendingVerifications);
    };
  }, [flushPendingVerifications]);

  const shortWallet = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : null;

  const handleSendTip = async (
    lamports: number,
    solVal: number,
    tierId: number,
    trimmedName: string,
    trimmedMsg: string
  ) => {
    setError(null);
    if (!connected || !publicKey) {
      setError("Please connect your Phantom wallet first.");
      return;
    }

    if (!creatorProfile.isInitialized || !creatorProfile.authority) {
      setError(`Creator @${username} profile not found on Solana Devnet.`);
      return;
    }

    setIsLoading(true);
    try {
      const creatorAuth = new PublicKey(creatorProfile.authority);

      const { tx } = await sendTip(
        lamports,
        tierId,
        trimmedName,
        trimmedMsg,
        creatorAuth
      );

      const newTip: TipRecord = {
        signature: tx,
        donor: publicKey.toBase58(),
        displayName: trimmedName,
        amountLamports: lamports,
        tier: tierId,
        message: trimmedMsg,
        timestamp: Date.now(),
      };

      addStoredTip(username, newTip);
      refreshTips();

      setCreatorProfile((prev) => ({
        ...prev,
        goalCurrentSol: prev.goalCurrentSol + solVal,
      }));

      // Open modal immediately while server verification + ElevenLabs TTS resolves
      setSuccessTx({
        signature: tx,
        amountSol: solVal,
        displayName: trimmedName,
        message: trimmedMsg,
        serverVerified: false,
        ttsEngine: null,
      });
      setModalOpen(true);

      // Persist pending verification in localStorage before calling server so offline/failed requests auto-retry
      enqueuePendingVerification(username, tx);
      void submitVerifyRequest(tx, username);
    } catch (err: any) {
      console.error("Tip failed:", err);
      setError(err?.message || "Transaction failed on Solana Devnet.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0C10] text-[#E0E2EC] pb-24 overflow-x-clip">
      {/* Top Navbar */}
      <header className="relative z-50 w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <SolanaLogo className="w-6 h-5" />
            <span className="font-display text-xl font-bold tracking-tight text-white">
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
      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pt-4">
        {isCheckingCreator && (
          <div className="mb-6 p-4 rounded-2xl bg-[#13141F] border border-white/10 text-zinc-400 text-xs flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-[#14F195]" />
            <span>
              Looking up <strong className="text-white">@{username}</strong> on Solana Devnet...
            </span>
          </div>
        )}

        {!isCheckingCreator && !creatorProfile.isInitialized && (
          <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <span>
                <strong>Creator @{username} not found on Solana Devnet:</strong> This handle hasn&apos;t been registered on-chain yet. If you&apos;re a fan, browse active creators on the homepage.
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link
                href="/#creators"
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs tracking-wide transition-colors"
              >
                Explore Creators
              </Link>
              <Link
                href={`/claim?handle=${username}`}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs tracking-wide transition-colors"
              >
                Are you @{username}? Claim
              </Link>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* COLUMN 1: CREATOR PROFILE & GOAL (3 cols) */}
          <div className="lg:col-span-3 space-y-4">
            <CreatorProfileHeader
              username={username}
              authority={creatorProfile.authority}
            />
            <StreamGoalCard
              title={creatorProfile.goalTitle}
              currentSol={creatorProfile.goalCurrentSol}
              targetSol={creatorProfile.goalTargetSol}
            />
          </div>

          {/* COLUMN 2: SEND A TIP FORM (6 cols) */}
          <div className="lg:col-span-6">
            <TipForm
              username={username}
              isCreatorReady={creatorProfile.isInitialized}
              solUsdPrice={solUsdPrice}
              isLoading={isLoading}
              externalError={error}
              onSendTip={handleSendTip}
            />
          </div>

          {/* COLUMN 3: TOP SUPPORTERS LEADERBOARD (3 cols) */}
          <div className="lg:col-span-3">
            <TopDonorsLeaderboard
              tips={tips}
              leaderboard={leaderboard}
              username={username}
            />
          </div>
        </div>
      </main>

      {/* Tip Confirmation Modal */}
      <TipSuccessModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        signature={successTx.signature}
        amountSol={successTx.amountSol}
        displayName={successTx.displayName}
        message={successTx.message}
        username={username}
        serverVerified={successTx.serverVerified}
        ttsEngine={successTx.ttsEngine}
      />
    </div>
  );
}

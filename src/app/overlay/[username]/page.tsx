"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { getStoredTips, getStoredCreator } from "@/lib/storage";

interface AlertItem {
  id: string;
  signature: string;
  displayName: string;
  amountSol: number;
  tier: number;
  tierName: string;
  message: string;
  audioDataUrl?: string | null;
}

const TIER_NAMES = ["Coffee", "Rose", "Fire", "Diamond", "Rocket", "Crown"];
const TIER_EMOJIS = ["☕", "🌹", "🔥", "💎", "🚀", "👑"];

function playAlertChime() {
  try {
    const AudioCtx =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [659.25, 987.77];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.12);
      gain.gain.setValueAtTime(0.001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.12 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.48);
    });
  } catch {
    // Ignore autoplay restrictions gracefully
  }
}

function speakFallback(displayName: string, amountSol: number, message: string) {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
      const text = `${displayName} tipped ${amountSol} SOL. ${message}`;
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.0;
      utter.pitch = 1.0;
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore speech errors
    }
  }
}

export default function ObsOverlayPage({
  params,
}: {
  params: { username: string };
}) {
  const username = params.username.toLowerCase();

  const [queue, setQueue] = useState<AlertItem[]>([]);
  const [currentAlert, setCurrentAlert] = useState<AlertItem | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  const seenSigs = useRef<Set<string>>(new Set());
  const isFirstLocalLoad = useRef(true);
  const isFirstRemoteLoad = useRef(true);
  const isFetchingRemote = useRef(false);

  const [goal, setGoal] = useState({
    title: "Stream Goal",
    currentSol: 0,
    targetSol: 1.0,
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      const search = new URLSearchParams(window.location.search);
      setIsPreviewMode(search.get("preview") === "1");
    }
  }, []);

  const refreshGoal = useCallback(() => {
    const creator = getStoredCreator(username);
    const tips = getStoredTips(username);
    const tipsTotalSol =
      tips.reduce((acc, t) => acc + t.amountLamports, 0) / 1_000_000_000;

    if (creator) {
      const storedCurrent = (creator.goalCurrentLamports || 0) / 1_000_000_000;
      setGoal({
        title: creator.goalTitle || "Stream Goal",
        currentSol: Math.max(storedCurrent, tipsTotalSol),
        targetSol: (creator.goalTargetLamports || 1_000_000_000) / 1_000_000_000,
      });
    }
  }, [username]);

  useEffect(() => {
    refreshGoal();
  }, [refreshGoal]);

  const checkLocalTips = useCallback(() => {
    const storedTips = getStoredTips(username);

    if (isFirstLocalLoad.current) {
      storedTips.forEach((t) => seenSigs.current.add(t.signature));
      isFirstLocalLoad.current = false;
      return;
    }

    const newTips = storedTips.filter((t) => !seenSigs.current.has(t.signature));
    if (newTips.length > 0) {
      newTips.forEach((t) => seenSigs.current.add(t.signature));

      const newAlerts: AlertItem[] = newTips.map((t) => ({
        id: t.signature,
        signature: t.signature,
        displayName: t.displayName,
        amountSol: t.amountLamports / 1_000_000_000,
        tier: typeof t.tier === "number" ? t.tier : 3,
        tierName: TIER_NAMES[t.tier] || "Tip",
        message: t.message,
      }));

      setQueue((prev) => [...prev, ...newAlerts]);
      refreshGoal();
    }
  }, [username, refreshGoal]);

  const checkRemoteTips = useCallback(async () => {
    if (isFetchingRemote.current) return;
    isFetchingRemote.current = true;
    try {
      const res = await fetch(`/api/creators/${encodeURIComponent(username)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();

      if (data?.creator) {
        const c = data.creator;
        setGoal({
          title: c.goalTitle || "Stream Goal",
          currentSol: (c.goalCurrentLamports || 0) / 1_000_000_000,
          targetSol: (c.goalTargetLamports || 1_000_000_000) / 1_000_000_000,
        });
      }

      const remoteTips: any[] = data?.tips || [];
      if (isFirstRemoteLoad.current) {
        remoteTips.forEach((t) => seenSigs.current.add(t.signature));
        isFirstRemoteLoad.current = false;
        return;
      }

      const newTips = remoteTips.filter((t) => !seenSigs.current.has(t.signature));
      if (newTips.length > 0) {
        newTips.forEach((t) => seenSigs.current.add(t.signature));
        const newAlerts: AlertItem[] = newTips.map((t) => ({
          id: t.signature,
          signature: t.signature,
          displayName: t.displayName || "Anonymous",
          amountSol: (Number(t.amountLamports) || 0) / 1_000_000_000,
          tier: typeof t.tier === "number" ? t.tier : 3,
          tierName: TIER_NAMES[t.tier] || "Tip",
          message: t.message || "",
          audioDataUrl: t.audioDataUrl || null,
        }));
        setQueue((prev) => [...prev, ...newAlerts]);
      }
    } catch {
      // Transient RPC error ignored gracefully
    } finally {
      isFetchingRemote.current = false;
    }
  }, [username]);

  useEffect(() => {
    checkLocalTips();
    checkRemoteTips();

    const localTimer = setInterval(checkLocalTips, 1000);
    const remoteTimer = setInterval(checkRemoteTips, 2500);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === `solstream_tips_${username}`) checkLocalTips();
      if (e.key === "solstream_creators") refreshGoal();
    };
    const handleCustom = (e: any) => {
      if (e.detail?.username === username) checkLocalTips();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("solstream_new_tip", handleCustom);

    return () => {
      clearInterval(localTimer);
      clearInterval(remoteTimer);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("solstream_new_tip", handleCustom);
    };
  }, [checkLocalTips, checkRemoteTips, refreshGoal, username]);

  // FIFO Alert Queue Processor (ElevenLabs MP3 or Web Speech fallback)
  useEffect(() => {
    if (!currentAlert && queue.length > 0) {
      const nextAlert = queue[0];
      setQueue((prev) => prev.slice(1));
      setCurrentAlert(nextAlert);

      playAlertChime();

      setTimeout(() => {
        if (nextAlert.audioDataUrl) {
          const audio = new Audio(nextAlert.audioDataUrl);
          audio.play().catch(() => {
            speakFallback(
              nextAlert.displayName,
              nextAlert.amountSol,
              nextAlert.message
            );
          });
        } else {
          speakFallback(
            nextAlert.displayName,
            nextAlert.amountSol,
            nextAlert.message
          );
        }
      }, 350);

      const dismissTimer = setTimeout(() => {
        setCurrentAlert(null);
      }, 7000);

      return () => clearTimeout(dismissTimer);
    }
  }, [currentAlert, queue]);

  const triggerPreviewAlert = () => {
    const sample: AlertItem = {
      id: `preview-${Date.now()}`,
      signature: "preview",
      displayName: "Test Viewer",
      amountSol: 0.05,
      tier: 3,
      tierName: "Diamond",
      message: "Audio & OBS overlay test looks crisp!",
    };
    setQueue((prev) => [...prev, sample]);
  };

  const percentage = Math.min(
    Math.round((goal.currentSol / (goal.targetSol || 1)) * 100),
    100
  );

  return (
    <div className="relative w-screen h-screen bg-transparent overflow-hidden select-none flex flex-col justify-between p-8 group">
      {/* Top Helper Pills: invisible in live OBS unless ?preview=1 or mouse hovered */}
      <div
        className={`flex items-center justify-between text-xs transition-opacity duration-300 ${
          isPreviewMode
            ? "opacity-90 hover:opacity-100"
            : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <div className="px-3.5 py-1.5 rounded-full bg-black/70 border border-white/10 text-zinc-400 font-medium">
          OBS Browser Source:{" "}
          <span className="font-mono text-white">@{username}</span> (Clean Canvas)
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={triggerPreviewAlert}
            className="px-3.5 py-1.5 rounded-full bg-[#14F195] hover:bg-[#12DB87] text-[#090A0F] font-bold text-[11px] shadow-lg transition-colors cursor-pointer"
          >
            Test Alert &amp; Sound
          </button>
          <div className="px-3.5 py-1.5 rounded-full bg-[#9945FF] text-white font-medium text-[11px] shadow-lg shadow-[#9945FF]/20">
            7s auto-dismiss · FIFO queue
          </div>
        </div>
      </div>

      {/* CENTER REAL-TIME ALERT POPUP */}
      <div className="flex-1 flex items-center justify-center">
        {currentAlert && (
          <div className="relative animate-bounce-short w-full max-w-xl">
            <div className="absolute inset-0 bg-gradient-to-r from-[#9945FF]/40 to-[#14F195]/40 blur-2xl rounded-3xl" />

            <div className="relative rounded-3xl bg-[#13141F]/95 border-2 border-[#14F195]/70 p-6 md:p-8 w-full shadow-2xl backdrop-blur-xl">
              <div className="flex items-center gap-4 mb-3">
                <div className="w-12 h-12 rounded-2xl bg-[#00F0FF]/15 border border-[#00F0FF]/30 flex items-center justify-center text-2xl shadow-lg shadow-[#00F0FF]/20">
                  {TIER_EMOJIS[currentAlert.tier] || "💎"}
                </div>

                <div>
                  <h2 className="font-display text-2xl font-bold text-white tracking-tight">
                    {currentAlert.displayName} tipped{" "}
                    <span className="font-mono text-[#14F195]">
                      {currentAlert.amountSol} SOL
                    </span>
                  </h2>
                  <div className="text-xs font-bold text-[#14F195] tracking-wide">
                    {currentAlert.tierName} · Verified on Solana
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 bg-[#090A0F]/80 border border-white/10 rounded-2xl p-4">
                <p className="flex-1 text-sm text-zinc-100 font-medium">
                  {currentAlert.message}
                </p>

                <div className="flex items-end gap-1 h-6 flex-shrink-0">
                  <span className="w-1.5 h-3 bg-[#E031E0] rounded-full animate-pulse" />
                  <span className="w-1.5 h-5 bg-[#00F0FF] rounded-full animate-pulse delay-75" />
                  <span className="w-1.5 h-6 bg-[#14F195] rounded-full animate-pulse delay-150" />
                  <span className="w-1.5 h-4 bg-[#9945FF] rounded-full animate-pulse delay-100" />
                  <span className="w-1.5 h-2 bg-[#00F0FF] rounded-full animate-pulse delay-200" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM ROW: STREAM GOAL BAR */}
      <div className="flex items-end justify-between w-full">
        <div className="w-full max-w-md rounded-2xl bg-[#13141F]/90 border border-white/10 p-3.5 backdrop-blur-md shadow-2xl">
          <div className="flex items-center justify-between text-xs font-bold mb-2">
            <span className="font-display text-white">{goal.title}</span>
            <span className="text-[#14F195] font-mono tabular-nums">
              {goal.currentSol.toFixed(3)} / {goal.targetSol.toFixed(1)} SOL
            </span>
          </div>

          <div className="relative w-full h-2.5 bg-black/60 rounded-full overflow-hidden p-0.5 border border-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#9945FF] to-[#14F195] transition-all duration-500"
              style={{ width: `${Math.max(percentage, 5)}%` }}
            />
          </div>
        </div>

        {/* Streamer camera box: visible only in ?preview=1 mode so OBS remains clean */}
        {isPreviewMode && (
          <div className="w-48 h-32 rounded-2xl bg-[#13141F]/50 border border-white/5 flex items-center justify-center text-xs text-zinc-600">
            Streamer camera area
          </div>
        )}
      </div>
    </div>
  );
}

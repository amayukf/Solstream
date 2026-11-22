"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { getStoredTips, getStoredCreator, TipRecord } from "@/lib/storage";

interface AlertItem {
  id: string;
  signature: string;
  displayName: string;
  amountSol: number;
  tierName: string;
  message: string;
}

const TIER_NAMES = ["Coffee", "Rose", "Fire", "Diamond", "Rocket", "Crown"];
const TIER_EMOJIS = ["☕", "🌹", "🔥", "💎", "🚀", "👑"];

export default function ObsOverlayPage({ params }: { params: { username: string } }) {
  const username = params.username.toLowerCase();

  const [queue, setQueue] = useState<AlertItem[]>([]);
  const [currentAlert, setCurrentAlert] = useState<AlertItem | null>(null);

  // Track already seen/played tip signatures
  const seenSigs = useRef<Set<string>>(new Set());
  const isFirstLoad = useRef(true);

  // Goal state
  const [goal, setGoal] = useState({
    title: "Stream Goal",
    currentSol: 0,
    targetSol: 1.0,
  });

  // Load creator goal
  useEffect(() => {
    const creator = getStoredCreator(username);
    if (creator) {
      setGoal({
        title: creator.goalTitle || "Stream Goal",
        currentSol: creator.goalCurrentLamports / 1_000_000_000,
        targetSol: creator.goalTargetLamports / 1_000_000_000 || 1.0,
      });
    }
  }, [username]);

  // Check for new tips from localStorage
  const checkTips = useCallback(() => {
    const storedTips = getStoredTips(username);

    // If first load, mark existing tips as already seen so we only alert NEW incoming tips
    if (isFirstLoad.current) {
      storedTips.forEach((t) => seenSigs.current.add(t.signature));
      isFirstLoad.current = false;
      return;
    }

    // Find any new tips not yet seen
    const newTips = storedTips.filter((t) => !seenSigs.current.has(t.signature));
    if (newTips.length > 0) {
      newTips.forEach((t) => seenSigs.current.add(t.signature));

      const newAlerts: AlertItem[] = newTips.map((t) => ({
        id: t.signature,
        signature: t.signature,
        displayName: t.displayName,
        amountSol: t.amountLamports / 1_000_000_000,
        tierName: TIER_NAMES[t.tier] || "Tip",
        message: t.message,
      }));

      setQueue((prev) => [...prev, ...newAlerts]);
    }
  }, [username]);

  useEffect(() => {
    checkTips();

    // Poll every 1s for instant detection across any tab/process
    const timer = setInterval(checkTips, 1000);

    // Also listen to storage & custom event
    const handleStorage = (e: StorageEvent) => {
      if (e.key === `solstream_tips_${username}`) checkTips();
    };
    const handleCustom = (e: any) => {
      if (e.detail?.username === username) checkTips();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("solstream_new_tip", handleCustom);

    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("solstream_new_tip", handleCustom);
    };
  }, [checkTips, username]);

  // FIFO Alert Queue Processor
  useEffect(() => {
    if (!currentAlert && queue.length > 0) {
      const nextAlert = queue[0];
      setQueue((prev) => prev.slice(1));
      setCurrentAlert(nextAlert);

      // Web Speech API / TTS
      if (typeof window !== "undefined" && window.speechSynthesis) {
        const text = `${nextAlert.displayName} tipped ${nextAlert.amountSol} SOL. ${nextAlert.message}`;
        const utter = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(utter);
      }

      // Update local goal
      setGoal((prev) => ({
        ...prev,
        currentSol: prev.currentSol + nextAlert.amountSol,
      }));

      // Auto-dismiss alert after 7 seconds
      const dismissTimer = setTimeout(() => {
        setCurrentAlert(null);
      }, 7000);

      return () => clearTimeout(dismissTimer);
    }
  }, [currentAlert, queue]);

  const percentage = Math.min(
    Math.round((goal.currentSol / (goal.targetSol || 1)) * 100),
    100
  );

  return (
    <div className="relative w-screen h-screen bg-transparent overflow-hidden select-none flex flex-col justify-between p-8">
      {/* Top Helper Pills */}
      <div className="flex items-center justify-between text-xs opacity-40 hover:opacity-100 transition-opacity">
        <div className="px-3.5 py-1.5 rounded-full bg-black/70 border border-white/10 text-zinc-400 font-medium">
          OBS Browser Source: @{username} (Transparent Canvas)
        </div>

        <div className="px-3.5 py-1.5 rounded-full bg-[#9945FF] text-white font-medium text-[11px] shadow-lg shadow-[#9945FF]/20">
          Alert shows 7 s, then fades. Queued tips play one at a time.
        </div>
      </div>

      {/* CENTER REAL-TIME ALERT POPUP */}
      <div className="flex-1 flex items-center justify-center">
        {currentAlert && (
          <div className="relative animate-bounce-short">
            {/* Ambient neon backdrop glow */}
            <div className="absolute inset-0 bg-gradient-to-r from-[#9945FF]/40 to-[#14F195]/40 blur-2xl rounded-3xl" />

            <div className="relative rounded-3xl bg-[#13141F]/95 border-2 border-[#14F195]/70 p-6 md:p-8 max-w-xl w-full shadow-2xl backdrop-blur-xl">
              <div className="flex items-center gap-4 mb-3">
                <div className="w-12 h-12 rounded-2xl bg-[#00F0FF]/15 border border-[#00F0FF]/30 flex items-center justify-center text-2xl shadow-lg shadow-[#00F0FF]/20">
                  💎
                </div>

                <div>
                  <h2 className="text-2xl font-black text-white tracking-tight">
                    {currentAlert.displayName} tipped {currentAlert.amountSol} SOL
                  </h2>
                  <div className="text-xs font-bold text-[#14F195] tracking-wide">
                    {currentAlert.tierName} · Verified on Solana
                  </div>
                </div>
              </div>

              {/* Message Box & Animated Equalizer */}
              <div className="flex items-center gap-4 bg-[#090A0F]/80 border border-white/10 rounded-2xl p-4">
                <p className="flex-1 text-sm text-zinc-100 font-medium">
                  {currentAlert.message}
                </p>

                {/* Animated Equalizer Waveform */}
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
            <span className="text-white">{goal.title}</span>
            <span className="text-[#14F195] font-mono">
              {goal.currentSol.toFixed(2)} / {goal.targetSol.toFixed(1)} SOL
            </span>
          </div>

          <div className="relative w-full h-2.5 bg-black/60 rounded-full overflow-hidden p-0.5 border border-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#9945FF] to-[#14F195] transition-all duration-500"
              style={{ width: `${Math.max(percentage, 5)}%` }}
            />
          </div>
        </div>

        {/* Streamer Camera Box */}
        <div className="w-48 h-32 rounded-2xl bg-[#13141F]/50 border border-white/5 flex items-center justify-center text-xs text-zinc-600">
          Streamer camera
        </div>
      </div>
    </div>
  );
}

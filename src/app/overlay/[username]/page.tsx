"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { getStoredTips, getStoredCreator } from "@/lib/storage";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { GiftIcon } from "@/components/tipping/GiftIcon";

interface AlertItem {
  id: string;
  signature: string;
  donor: string;
  displayName: string;
  amountSol: number;
  tier: number;
  tierName: string;
  message: string;
  timestamp: number;
  audioUrl?: string | null;
}

function toPlayableAudioUrl(raw?: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed;
  }
  return null;
}

const TIER_STYLES = [
  { name: "Coffee", emoji: "☕", border: "#E2B77A", glow: "rgba(226, 183, 122, 0.35)" },
  { name: "Rose", emoji: "🌹", border: "#FF5E7E", glow: "rgba(255, 94, 126, 0.35)" },
  { name: "Fire", emoji: "🔥", border: "#FF8C00", glow: "rgba(255, 140, 0, 0.35)" },
  { name: "Diamond", emoji: "💎", border: "#00F0FF", glow: "rgba(0, 240, 255, 0.35)" },
  { name: "Rocket", emoji: "🚀", border: "#9945FF", glow: "rgba(153, 69, 255, 0.45)" },
  { name: "Crown", emoji: "👑", border: "#FFD700", glow: "rgba(255, 215, 0, 0.45)" },
];

const MAX_TRACKED_SIGS = 200;
const MAX_CACHED_AUDIO = 50;

function addToCappedSet(set: Set<string>, value: string, maxSize = MAX_TRACKED_SIGS) {
  if (set.has(value)) return;
  while (set.size >= maxSize) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
  set.add(value);
}

function setInCappedMap(
  map: Map<string, string>,
  key: string,
  value: string,
  maxSize = MAX_CACHED_AUDIO
) {
  if (map.has(key)) map.delete(key);
  while (map.size >= maxSize) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  map.set(key, value);
}

let sharedAudioCtx: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new AudioCtx();
  }
  return sharedAudioCtx;
}

async function playFastChime() {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const notes = [783.99, 1046.5]; // Crisp fast G5 -> C6 chime (180ms total)
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.08);
      gain.gain.setValueAtTime(0.001, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.1, now + i * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          // Ignore already disconnected nodes
        }
      };
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.28);
    });
  } catch {
    // Ignore browser autoplay restrictions gracefully
  }
}

function speakFastFallback(
  displayName: string,
  amountSol: number,
  message: string
) {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
      const text = `${displayName} tipped ${amountSol} SOL. ${message}`;
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.18; // Snappy fast stream delivery
      utter.pitch = 1.0;
      window.speechSynthesis.speak(utter);
    } catch {
      // Graceful fallback
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
  const [sseConnected, setSseConnected] = useState(false);
  const [solUsdPrice, setSolUsdPrice] = useState<number | null>(null);
  const [latestTip, setLatestTip] = useState<AlertItem | null>(null);
  const [stats, setStats] = useState({ totalTips: 0, totalVolumeSol: 0 });

  const seenSigs = useRef<Set<string>>(new Set());
  const audioBySig = useRef<Map<string, string>>(new Map());
  const playedAudioSigs = useRef<Set<string>>(new Set());
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentAlertRef = useRef<AlertItem | null>(null);
  currentAlertRef.current = currentAlert;
  const isFirstLocalLoad = useRef(true);

  const [goal, setGoal] = useState({
    title: "Stream Goal",
    currentSol: 0,
    targetSol: 1.0,
  });

  const cleanupAudioElement = useCallback((el?: HTMLAudioElement | null) => {
    const target = el ?? activeAudioRef.current;
    if (!target) return;
    target.onended = null;
    target.onerror = null;
    try {
      target.pause();
      target.removeAttribute("src");
      target.load();
    } catch {
      // Ignore cleanup errors
    }
    if (target === activeAudioRef.current) {
      activeAudioRef.current = null;
    }
  }, []);

  // Make overlay html & body transparent on mount; restore original styles on unmount
  useEffect(() => {
    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    const prevHtmlBg = htmlEl.style.background;
    const prevHtmlBgColor = htmlEl.style.backgroundColor;
    const prevBodyBg = bodyEl.style.background;
    const prevBodyBgColor = bodyEl.style.backgroundColor;

    htmlEl.classList.add("obs-transparent");
    bodyEl.classList.add("obs-transparent");
    htmlEl.style.background = "transparent";
    htmlEl.style.backgroundColor = "transparent";
    bodyEl.style.background = "transparent";
    bodyEl.style.backgroundColor = "transparent";

    return () => {
      cleanupAudioElement();
      htmlEl.classList.remove("obs-transparent");
      bodyEl.classList.remove("obs-transparent");
      htmlEl.style.background = prevHtmlBg;
      htmlEl.style.backgroundColor = prevHtmlBgColor;
      bodyEl.style.background = prevBodyBg;
      bodyEl.style.backgroundColor = prevBodyBgColor;
    };
  }, [cleanupAudioElement]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const search = new URLSearchParams(window.location.search);
      setIsPreviewMode(search.get("preview") === "1");
    }
  }, []);

  // Fetch live SOL/USD price for real-time USD conversion on alert cards
  useEffect(() => {
    const fetchPrice = () => {
      fetch("/api/prices")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const sol = data?.coins?.find((c: any) => c.symbol === "SOL");
          if (sol?.priceUsd) setSolUsdPrice(sol.priceUsd);
        })
        .catch(() => {});
    };
    fetchPrice();
    const timer = setInterval(fetchPrice, 60_000);
    return () => clearInterval(timer);
  }, []);

  const toAlertItem = useCallback((t: any): AlertItem => {
    const tierIdx = typeof t.tier === "number" ? t.tier : 0;
    const style = TIER_STYLES[tierIdx] || TIER_STYLES[0];
    return {
      id: t.signature,
      signature: t.signature,
      donor: t.donor || "",
      displayName: t.displayName || "Anonymous",
      amountSol: (Number(t.amountLamports) || 0) / 1_000_000_000,
      tier: tierIdx,
      tierName: style.name,
      message: t.message || "",
      timestamp: Number(t.timestamp) || Date.now(),
      audioUrl: toPlayableAudioUrl(t.audioUrl ?? t.audio_url),
    };
  }, []);

  const enqueueIncomingTip = useCallback(
    (rawTip: any) => {
      const item = toAlertItem(rawTip);
      if (item.audioUrl) {
        setInCappedMap(audioBySig.current, item.signature, item.audioUrl);
      }

      setLatestTip(item);

      if (seenSigs.current.has(item.signature)) {
        // If alert is currently visible and ElevenLabs audio URL just arrived over SSE/Realtime, update it!
        setCurrentAlert((curr) =>
          curr && curr.signature === item.signature && item.audioUrl
            ? { ...curr, audioUrl: item.audioUrl }
            : curr
        );
        return;
      }

      addToCappedSet(seenSigs.current, item.signature);
      setQueue((prev) => [...prev, item]);
      setGoal((prev) => ({
        ...prev,
        currentSol: prev.currentSol + item.amountSol,
      }));
      setStats((prev) => ({
        totalTips: prev.totalTips + 1,
        totalVolumeSol: prev.totalVolumeSol + item.amountSol,
      }));
    },
    [toAlertItem]
  );

  // Initial localStorage goal & seen tracking
  useEffect(() => {
    const creator = getStoredCreator(username);
    const localTips = getStoredTips(username);
    if (isFirstLocalLoad.current) {
      localTips.forEach((t) => addToCappedSet(seenSigs.current, t.signature));
      if (localTips.length > 0) {
        setLatestTip(toAlertItem(localTips[0]));
      }
      isFirstLocalLoad.current = false;
    }
    if (creator) {
      setGoal({
        title: creator.goalTitle || "Stream Goal",
        currentSol: (creator.goalCurrentLamports || 0) / 1_000_000_000,
        targetSol:
          (creator.goalTargetLamports || 1_000_000_000) / 1_000_000_000,
      });
    }
  }, [username, toAlertItem]);

  // 1. Primary Real-Time Transport: Server-Sent Events (SSE) for instant <50ms cross-device alerts + ElevenLabs audio
  useEffect(() => {
    const es = new EventSource(
      `/api/overlay/${encodeURIComponent(username)}/stream`
    );

    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);

    es.addEventListener("init", (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data);
        if (data?.creator) {
          const c = data.creator;
          setGoal({
            title: c.goalTitle || "Stream Goal",
            currentSol: (c.goalCurrentLamports || 0) / 1_000_000_000,
            targetSol: (c.goalTargetLamports || 1_000_000_000) / 1_000_000_000,
          });
          setStats({
            totalTips: Number(c.totalTips) || 0,
            totalVolumeSol: (Number(c.totalVolume) || 0) / 1_000_000_000,
          });
        }
        const initTips: any[] = data?.tips || [];
        initTips.forEach((t) => addToCappedSet(seenSigs.current, t.signature));
        if (initTips.length > 0) {
          setLatestTip(toAlertItem(initTips[0]));
          setStats((prev) => ({
            totalTips: Math.max(prev.totalTips, initTips.length),
            totalVolumeSol: Math.max(
              prev.totalVolumeSol,
              initTips.reduce(
                (acc, t) => acc + (Number(t.amountLamports) || 0),
                0
              ) / 1_000_000_000
            ),
          }));
        }
      } catch {}
    });

    es.addEventListener("tip", (evt: MessageEvent) => {
      try {
        const tip = JSON.parse(evt.data);
        enqueueIncomingTip(tip);
      } catch {}
    });

    return () => {
      es.close();
      setSseConnected(false);
    };
  }, [username, enqueueIncomingTip, toAlertItem]);

  // 1b. Supabase Realtime WebSocket subscription (works across distributed servers / OBS)
  useEffect(() => {
    const sb = getSupabaseClient();
    if (!sb) return;

    const channel = sb
      .channel(`overlay-realtime-${username}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tips",
          filter: `username=eq.${username}`,
        },
        (payload) => {
          const row: any = payload.new;
          if (!row?.signature) return;
          enqueueIncomingTip({
            signature: row.signature,
            donor: row.donor_wallet,
            displayName: row.display_name,
            amountLamports: Number(row.amount_lamports) || 0,
            tier: Number(row.tier) || 0,
            message: row.message || "",
            timestamp: new Date(row.created_at).getTime(),
            audioUrl: toPlayableAudioUrl(row.audio_url),
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "creators",
          filter: `username=eq.${username}`,
        },
        (payload) => {
          const c: any = payload.new;
          if (!c) return;
          setGoal({
            title: c.goal_title || "Stream Goal",
            currentSol: (Number(c.goal_current_lamports) || 0) / 1_000_000_000,
            targetSol:
              (Number(c.goal_target_lamports) || 1_000_000_000) / 1_000_000_000,
          });
        }
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [username, enqueueIncomingTip]);

  // 2. Local Instant Transport: BroadcastChannel + storage events for 0ms same-browser responsiveness
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === `solstream_tips_${username}`) {
        const tips = getStoredTips(username);
        for (const t of tips) {
          if (!seenSigs.current.has(t.signature)) {
            enqueueIncomingTip(t);
          }
        }
      }
    };
    const handleCustom = (e: any) => {
      if (e.detail?.username === username && e.detail?.tip) {
        enqueueIncomingTip(e.detail.tip);
      }
    };

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(`solstream_alerts_${username}`);
      bc.onmessage = (e) => {
        if (e.data?.signature) enqueueIncomingTip(e.data);
      };
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("solstream_new_tip", handleCustom);

    return () => {
      bc?.close();
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("solstream_new_tip", handleCustom);
    };
  }, [username, enqueueIncomingTip]);

  // 3a. FIFO Queue Promotion (removes promoted item by id; never clears timers)
  useEffect(() => {
    if (currentAlert || queue.length === 0) return;
    const nextAlert = queue[0];
    setQueue((prev) => prev.filter((item) => item.id !== nextAlert.id));
    setCurrentAlert(nextAlert);
  }, [currentAlert, queue]);

  // Helper to play Audio element cleanly and fall back on playback failure
  const playTipAudio = useCallback(
    (audioUrl: string, alert: AlertItem, allowSpeechFallback: boolean) => {
      cleanupAudioElement();
      const audio = new Audio(audioUrl);
      audio.playbackRate = 1.05;
      activeAudioRef.current = audio;

      audio.onended = () => cleanupAudioElement(audio);
      audio.onerror = () => {
        cleanupAudioElement(audio);
        if (allowSpeechFallback) {
          speakFastFallback(alert.displayName, alert.amountSol, alert.message);
        }
      };

      audio.play().catch(() => {
        cleanupAudioElement(audio);
        if (allowSpeechFallback) {
          speakFastFallback(alert.displayName, alert.amountSol, alert.message);
        }
      });
    },
    [cleanupAudioElement]
  );

  // 3b. 7-second Dismiss Timer keyed strictly to currentAlert?.id
  useEffect(() => {
    if (!currentAlert?.id) return;
    const dismissTimer = setTimeout(() => {
      setCurrentAlert(null);
    }, 7000);
    return () => clearTimeout(dismissTimer);
  }, [currentAlert?.id]);

  // 3c. Chime + 220ms Audio Trigger keyed strictly to currentAlert?.id
  useEffect(() => {
    const alertId = currentAlert?.id;
    const alert = currentAlertRef.current;
    if (!alertId || !alert) return;

    void playFastChime();

    const audioTimer = setTimeout(() => {
      const latestAlert = currentAlertRef.current;
      if (!latestAlert || latestAlert.id !== alertId) return;
      if (playedAudioSigs.current.has(latestAlert.signature)) return;

      addToCappedSet(playedAudioSigs.current, latestAlert.signature);

      const cachedAudio =
        latestAlert.audioUrl ||
        audioBySig.current.get(latestAlert.signature) ||
        null;

      if (cachedAudio) {
        playTipAudio(cachedAudio, latestAlert, true);
      } else {
        speakFastFallback(
          latestAlert.displayName,
          latestAlert.amountSol,
          latestAlert.message
        );
      }
    }, 220);

    return () => {
      clearTimeout(audioTimer);
    };
  }, [currentAlert?.id, playTipAudio]);

  // 3d. If ElevenLabs audio URL arrives while alert is active and hasn't played yet
  useEffect(() => {
    if (
      currentAlert?.audioUrl &&
      !playedAudioSigs.current.has(currentAlert.signature)
    ) {
      addToCappedSet(playedAudioSigs.current, currentAlert.signature);
      playTipAudio(currentAlert.audioUrl, currentAlert, false);
    }
  }, [currentAlert?.id, currentAlert?.audioUrl, currentAlert, playTipAudio]);

  const replayLatestRealTip = () => {
    if (!latestTip) return;
    const replayId = `${latestTip.signature}-replay-${Date.now()}`;
    const cachedAudio =
      latestTip.audioUrl || audioBySig.current.get(latestTip.signature) || null;
    if (cachedAudio) {
      setInCappedMap(audioBySig.current, replayId, cachedAudio);
    }
    playedAudioSigs.current.delete(replayId);
    setQueue((prev) => [
      ...prev,
      { ...latestTip, id: replayId, signature: replayId, audioUrl: cachedAudio },
    ]);
  };

  const percentage = Math.min(
    Math.round((goal.currentSol / (goal.targetSol || 1)) * 100),
    100
  );

  const activeStyle = currentAlert
    ? TIER_STYLES[currentAlert.tier] || TIER_STYLES[0]
    : TIER_STYLES[3];

  return (
    <div className="relative w-screen h-screen bg-transparent overflow-hidden select-none flex flex-col justify-between p-4 sm:p-8 group">
      {/* Top Status Bar: Hidden during live OBS capture, shown on hover or ?preview=1 */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 text-xs transition-opacity duration-300 ${
          isPreviewMode ? "opacity-95" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <div className="px-3.5 py-1.5 rounded-full bg-black/80 border border-white/10 text-zinc-300 font-medium flex items-center gap-2 backdrop-blur-md">
          <span
            className={`w-2 h-2 rounded-full ${
              sseConnected ? "bg-[#14F195] animate-pulse" : "bg-amber-400"
            }`}
          />
          <span>
            OBS Overlay · <span className="font-mono text-white">@{username}</span> ·{" "}
            {sseConnected ? "Realtime SSE Connected" : "Connecting..."}
          </span>
        </div>

        {latestTip && (
          <button
            type="button"
            onClick={replayLatestRealTip}
            className="px-4 py-1.5 rounded-full bg-[#14F195] hover:bg-[#12DB87] text-[#090A0F] font-bold text-[11px] shadow-lg transition-colors cursor-pointer"
          >
            Replay Latest Real Tip
          </button>
        )}
      </div>

      {/* CENTER REAL-TIME ALERT POPUP */}
      <div className="flex-1 flex items-center justify-center">
        {currentAlert && (
          <div key={currentAlert.id} className="relative animate-bounce-short w-full max-w-2xl">
            {/* Dynamic tier ambient glow */}
            <div
              className="absolute inset-0 blur-3xl rounded-3xl opacity-70"
              style={{
                background: `radial-gradient(circle, ${activeStyle.glow}, transparent 75%)`,
              }}
            />

            <div
              className="relative rounded-3xl bg-[#0F101A]/95 border-2 overflow-hidden shadow-2xl backdrop-blur-xl"
              style={{ borderColor: activeStyle.border }}
            >
              <div className="p-4 sm:p-6 md:p-7 space-y-3 sm:space-y-4">
                {/* Top Header: Tipper Name, Wallet, Tier & Amount */}
                <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <GiftIcon tier={currentAlert.tier} size="lg" />

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span
                          className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider text-[#090A0F]"
                          style={{ backgroundColor: activeStyle.border }}
                        >
                          {activeStyle.name} Tier
                        </span>
                        {currentAlert.donor && (
                          <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 font-mono text-[10px] text-zinc-300">
                            {currentAlert.donor.slice(0, 4)}...
                            {currentAlert.donor.slice(-4)}
                          </span>
                        )}
                      </div>

                      <h2 className="font-display text-2xl font-bold text-white tracking-tight truncate">
                        {currentAlert.displayName}
                      </h2>
                    </div>
                  </div>

                  {/* Amount & Live USD */}
                  <div className="text-right flex-shrink-0">
                    <div className="font-mono tabular-nums text-2xl sm:text-3xl font-black text-[#14F195]">
                      +{currentAlert.amountSol.toFixed(3)} SOL
                    </div>
                    {solUsdPrice && (
                      <div className="font-mono tabular-nums text-xs text-zinc-400">
                        ≈ ${(currentAlert.amountSol * solUsdPrice).toFixed(2)} USD
                      </div>
                    )}
                  </div>
                </div>

                {/* Message Box + Animated Voice Waveform */}
                <div className="flex items-center gap-4 bg-black/50 border border-white/10 rounded-2xl p-4">
                  <p className="flex-1 text-base text-white font-medium leading-snug">
                    &ldquo;{currentAlert.message}&rdquo;
                  </p>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <div className="flex items-end gap-1 h-6">
                      <span className="w-1.5 h-3 bg-[#E031E0] rounded-full animate-pulse" />
                      <span className="w-1.5 h-5 bg-[#00F0FF] rounded-full animate-pulse delay-75" />
                      <span className="w-1.5 h-6 bg-[#14F195] rounded-full animate-pulse delay-150" />
                      <span className="w-1.5 h-4 bg-[#9945FF] rounded-full animate-pulse delay-100" />
                      <span className="w-1.5 h-2 bg-[#00F0FF] rounded-full animate-pulse delay-200" />
                    </div>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-400">
                      {currentAlert.audioUrl ? "ElevenLabs AI" : "AI Voice"}
                    </span>
                  </div>
                </div>

                {/* Footer Verification Proof */}
                <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                  <span className="inline-flex items-center gap-1.5 text-[#14F195]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#14F195]" />
                    Verified on Solana Devnet
                  </span>
                  {!currentAlert.signature.includes("-replay-") && (
                    <span>
                      tx: {currentAlert.signature.slice(0, 6)}...
                      {currentAlert.signature.slice(-6)}
                    </span>
                  )}
                </div>
              </div>

              {/* 7-second Smooth Countdown Progress Bar */}
              <div className="w-full h-1 bg-black/60">
                <div
                  className="h-full animate-shrink-7s"
                  style={{ backgroundColor: activeStyle.border }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM LIVE HUD: STREAM GOAL BAR + REAL-TIME LATEST TIPPER */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 w-full">
        {/* Live Goal Bar */}
        <div className="w-full max-w-md rounded-2xl bg-[#0F101A]/90 border border-white/10 p-4 backdrop-blur-md shadow-2xl">
          <div className="flex items-center justify-between text-xs font-bold mb-2">
            <span className="font-display text-white">{goal.title}</span>
            <span className="text-[#14F195] font-mono tabular-nums">
              {goal.currentSol.toFixed(3)} / {goal.targetSol.toFixed(1)} SOL (
              {percentage}%)
            </span>
          </div>

          <div className="relative w-full h-2.5 bg-black/60 rounded-full overflow-hidden p-0.5 border border-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#9945FF] to-[#14F195] transition-all duration-500"
              style={{ width: `${Math.max(percentage, 4)}%` }}
            />
          </div>
        </div>

        {/* Real-Time Latest Tipper HUD (Only renders when real tips exist on-chain) */}
        {latestTip && (
          <div className="rounded-2xl bg-[#0F101A]/90 border border-white/10 px-4 py-3 backdrop-blur-md shadow-2xl flex items-center gap-3.5 max-w-sm">
            <GiftIcon tier={latestTip.tier} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                <span>Latest Supporter</span>
                <span className="font-mono text-[#14F195]">
                  · {stats.totalTips} tip{stats.totalTips === 1 ? "" : "s"}
                </span>
              </div>
              <div className="text-xs font-bold text-white truncate">
                {latestTip.displayName}{" "}
                <span className="font-mono text-[#14F195]">
                  ({latestTip.amountSol.toFixed(3)} SOL)
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import React, { use, useState, useEffect, useRef, useCallback } from "react";
import { Keypair } from "@solana/web3.js";
import { QRCodeSVG } from "qrcode.react";
import { getStoredTips, getStoredCreator } from "@/lib/storage";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  classifyPollVote,
  stripVoteTagForSpeech,
  type CreatorPollState,
} from "@/lib/polls";
import { GiftIcon } from "@/components/tipping/GiftIcon";
import { Move, Pencil, RotateCcw, Check, QrCode, Vote } from "lucide-react";

interface WidgetOffset {
  x: number;
  y: number;
}

interface OverlayLayout {
  alertPos: WidgetOffset;
  goalPos: WidgetOffset;
  supporterPos: WidgetOffset;
  pollPos: WidgetOffset;
  qrPos: WidgetOffset;
  showQrWidget: boolean;
  customGoalTitle?: string;
}

const DEFAULT_OVERLAY_LAYOUT: OverlayLayout = {
  alertPos: { x: 0, y: 0 },
  goalPos: { x: 0, y: 0 },
  supporterPos: { x: 0, y: 0 },
  pollPos: { x: 0, y: 0 },
  qrPos: { x: 0, y: 0 },
  showQrWidget: false,
  customGoalTitle: "",
};

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
      const spokenMsg = stripVoteTagForSpeech(message || "");
      const text = spokenMsg
        ? `${displayName} tipped ${amountSol} SOL. ${spokenMsg}`
        : `${displayName} tipped ${amountSol} SOL.`;
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
  params: Promise<{ username: string }>;
}) {
  const { username: rawUsername } = use(params);
  const username = rawUsername.toLowerCase();

  const [queue, setQueue] = useState<AlertItem[]>([]);
  const [currentAlert, setCurrentAlert] = useState<AlertItem | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [solUsdPrice, setSolUsdPrice] = useState<number | null>(null);
  const [latestTip, setLatestTip] = useState<AlertItem | null>(null);
  const [stats, setStats] = useState({ totalTips: 0, totalVolumeSol: 0 });
  const [activePoll, setActivePoll] = useState<CreatorPollState | null>(null);
  const [qrReference, setQrReference] = useState<string>("");
  const [overlayOrigin, setOverlayOrigin] = useState<string>("");
  const [isEditLayout, setIsEditLayout] = useState(false);
  const [isEditingGoalText, setIsEditingGoalText] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [layout, setLayout] = useState<OverlayLayout>(DEFAULT_OVERLAY_LAYOUT);

  const seenSigs = useRef<Set<string>>(new Set());
  const audioBySig = useRef<Map<string, string>>(new Map());
  const playedAudioSigs = useRef<Set<string>>(new Set());
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentAlertRef = useRef<AlertItem | null>(null);
  const isFirstLocalLoad = useRef(true);
  const syncedTotalTipsRef = useRef(0);
  const optimisticAheadRef = useRef(0);
  const authoritativeAheadRef = useRef(0);
  const audioPlaybackRef = useRef<{
    alertId: string;
    chimeDoneAt: number;
    audioPlayed: boolean;
  }>({ alertId: "", chimeDoneAt: 0, audioPlayed: false });
  const audioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    currentAlertRef.current = currentAlert;
  }, [currentAlert]);

  const [goal, setGoal] = useState({
    title: "Stream Goal",
    currentSol: 0,
    targetSol: 1.0,
  });

  const layoutStorageKey = `solstream_overlay_layout_${username}`;

  useEffect(() => {
    const timer = setTimeout(() => {
      setQrReference(Keypair.generate().publicKey.toBase58());
      setOverlayOrigin(window.location.origin);
      try {
        const params = new URLSearchParams(window.location.search);
        setIsPreviewMode(params.get("preview") === "1");
        if (params.get("edit") === "1") {
          setIsEditLayout(true);
        }
        const forceQr = params.get("qr") === "1";
        const raw = localStorage.getItem(layoutStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<OverlayLayout>;
          setLayout({
            alertPos: parsed.alertPos || { x: 0, y: 0 },
            goalPos: parsed.goalPos || { x: 0, y: 0 },
            supporterPos: parsed.supporterPos || { x: 0, y: 0 },
            pollPos: parsed.pollPos || { x: 0, y: 0 },
            qrPos: parsed.qrPos || { x: 0, y: 0 },
            showQrWidget: forceQr || Boolean(parsed.showQrWidget),
            customGoalTitle:
              typeof parsed.customGoalTitle === "string"
                ? parsed.customGoalTitle
                : "",
          });
        } else if (forceQr) {
          setLayout((prev) => ({ ...prev, showQrWidget: true }));
        }
      } catch {
        // Ignore malformed localStorage layout
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [layoutStorageKey]);

  const refreshPollState = useCallback(() => {
    fetch(`/api/polls/${encodeURIComponent(username)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && "poll" in d) setActivePoll(d.poll || null);
      })
      .catch(() => {});
  }, [username]);

  useEffect(() => {
    if (!layout.showQrWidget || !qrReference) return;
    const watchTimer = setInterval(() => {
      fetch(
        `/api/tips/watch?username=${encodeURIComponent(
          username
        )}&ref=${encodeURIComponent(qrReference)}`,
        { cache: "no-store" }
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.matched) {
            setQrReference(Keypair.generate().publicKey.toBase58());
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(watchTimer);
  }, [layout.showQrWidget, qrReference, username]);

  const persistLayout = useCallback(
    (next: OverlayLayout) => {
      setLayout(next);
      try {
        localStorage.setItem(layoutStorageKey, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
    },
    [layoutStorageKey]
  );

  const startWidgetDrag = useCallback(
    (
      key: "alertPos" | "goalPos" | "supporterPos" | "pollPos" | "qrPos",
      e: React.MouseEvent<HTMLDivElement>
    ) => {
      if (!isEditLayout || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest("input, button, textarea")) return;
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      const origin = layout[key];
      let latestLayout = layout;

      const onMove = (ev: MouseEvent) => {
        const next: OverlayLayout = {
          ...latestLayout,
          [key]: {
            x: Math.round(origin.x + (ev.clientX - startX)),
            y: Math.round(origin.y + (ev.clientY - startY)),
          },
        };
        latestLayout = next;
        setLayout(next);
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        persistLayout(latestLayout);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [isEditLayout, layout, persistLayout]
  );

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
      if (authoritativeAheadRef.current > 0) {
        authoritativeAheadRef.current -= 1;
      } else {
        optimisticAheadRef.current += 1;
        setGoal((prev) => ({
          ...prev,
          currentSol: prev.currentSol + item.amountSol,
        }));
        setStats((prev) => ({
          totalTips: prev.totalTips + 1,
          totalVolumeSol: prev.totalVolumeSol + item.amountSol,
        }));
      }
    },
    [toAlertItem]
  );

  // Initial localStorage goal & seen tracking
  useEffect(() => {
    const timer = setTimeout(() => {
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
    }, 0);
    return () => clearTimeout(timer);
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
          const totalTips = Number(c.totalTips) || 0;
          syncedTotalTipsRef.current = totalTips;
          optimisticAheadRef.current = 0;
          authoritativeAheadRef.current = 0;
          setGoal({
            title: c.goalTitle || "Stream Goal",
            currentSol: (c.goalCurrentLamports || 0) / 1_000_000_000,
            targetSol: (c.goalTargetLamports || 1_000_000_000) / 1_000_000_000,
          });
          setStats({
            totalTips,
            totalVolumeSol: (Number(c.totalVolume) || 0) / 1_000_000_000,
          });
        }
        if (data?.poll !== undefined) {
          setActivePoll(data.poll || null);
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
        refreshPollState();
      } catch {}
    });

    return () => {
      es.close();
      setSseConnected(false);
    };
  }, [username, enqueueIncomingTip, toAlertItem, refreshPollState]);

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
          const newTotalTips = Number(c.total_tips) || 0;
          const delta = Math.max(0, newTotalTips - syncedTotalTipsRef.current);
          syncedTotalTipsRef.current = Math.max(syncedTotalTipsRef.current, newTotalTips);
          const consumed = Math.min(delta, optimisticAheadRef.current);
          optimisticAheadRef.current -= consumed;
          authoritativeAheadRef.current += delta - consumed;

          setGoal({
            title: c.goal_title || "Stream Goal",
            currentSol: (Number(c.goal_current_lamports) || 0) / 1_000_000_000,
            targetSol:
              (Number(c.goal_target_lamports) || 1_000_000_000) / 1_000_000_000,
          });
          setStats((prev) => ({
            totalTips: Math.max(prev.totalTips, newTotalTips),
            totalVolumeSol: Math.max(
              prev.totalVolumeSol,
              (Number(c.total_volume_lamports) || 0) / 1_000_000_000
            ),
          }));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "creator_polls",
          filter: `username=eq.${username}`,
        },
        () => {
          refreshPollState();
        }
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [username, enqueueIncomingTip, refreshPollState]);

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
    const promoTimer = setTimeout(() => {
      setQueue((prev) => prev.filter((item) => item.id !== nextAlert.id));
      setCurrentAlert(nextAlert);
    }, 0);
    return () => clearTimeout(promoTimer);
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

  // 3c. Consolidated Chime + 220ms ElevenLabs Audio + Delayed Browser-Speech Fallback
  useEffect(() => {
    const clearAudioTimers = () => {
      if (audioTimerRef.current) {
        clearTimeout(audioTimerRef.current);
        audioTimerRef.current = null;
      }
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };

    const alertId = currentAlert?.id;
    const alertSnapshot = currentAlertRef.current;
    if (!alertId || !alertSnapshot) {
      clearAudioTimers();
      return;
    }

    if (audioPlaybackRef.current.alertId !== alertId) {
      audioPlaybackRef.current = {
        alertId,
        chimeDoneAt: Date.now() + 220,
        audioPlayed: false,
      };
      void playFastChime();
    }

    if (audioPlaybackRef.current.audioPlayed) {
      return;
    }

    clearAudioTimers();
    const remainingChimeMs = Math.max(
      0,
      audioPlaybackRef.current.chimeDoneAt - Date.now()
    );

    const resolvedAudio =
      currentAlert?.audioUrl ||
      audioBySig.current.get(alertSnapshot.signature) ||
      null;

    if (resolvedAudio) {
      audioTimerRef.current = setTimeout(() => {
        const latest = currentAlertRef.current;
        if (!latest || latest.id !== alertId) return;
        if (
          audioPlaybackRef.current.audioPlayed ||
          playedAudioSigs.current.has(latest.signature)
        ) {
          return;
        }
        audioPlaybackRef.current.audioPlayed = true;
        addToCappedSet(playedAudioSigs.current, latest.signature);
        playTipAudio(resolvedAudio, latest, true);
      }, remainingChimeMs);
    } else {
      // Wait briefly for server ElevenLabs audio URL before falling back to browser SpeechSynthesis
      fallbackTimerRef.current = setTimeout(() => {
        const latest = currentAlertRef.current;
        if (!latest || latest.id !== alertId) return;
        if (
          audioPlaybackRef.current.audioPlayed ||
          playedAudioSigs.current.has(latest.signature)
        ) {
          return;
        }
        const lateAudio =
          latest.audioUrl || audioBySig.current.get(latest.signature) || null;
        audioPlaybackRef.current.audioPlayed = true;
        addToCappedSet(playedAudioSigs.current, latest.signature);
        if (lateAudio) {
          playTipAudio(lateAudio, latest, true);
        } else {
          speakFastFallback(
            latest.displayName,
            latest.amountSol,
            latest.message
          );
        }
      }, remainingChimeMs + 1400);
    }

    return () => {
      clearAudioTimers();
    };
  }, [currentAlert?.id, currentAlert?.audioUrl, playTipAudio]);

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

  const displayAlert: AlertItem | null =
    currentAlert ||
    (isEditLayout
      ? latestTip || {
          id: "layout-preview",
          signature: "preview-replay-signature",
          donor: "",
          displayName: "Supporter Preview",
          amountSol: 0.05,
          tier: 3,
          tierName: "Diamond",
          message: "Drag this alert card anywhere so it never covers your face!",
          timestamp: 0,
          audioUrl: null,
        }
      : null);

  const activeStyle = displayAlert
    ? TIER_STYLES[displayAlert.tier] || TIER_STYLES[0]
    : TIER_STYLES[3];

  const displayedGoalTitle = layout.customGoalTitle?.trim() || goal.title;
  const solanaPayActionUrl =
    overlayOrigin && qrReference
      ? `${overlayOrigin}/api/actions/tip/${encodeURIComponent(
          username
        )}?ref=${encodeURIComponent(qrReference)}&source=obs-qr`
      : "";
  const solanaPayQrValue = solanaPayActionUrl
    ? `solana:${encodeURIComponent(solanaPayActionUrl)}`
    : "";
  const displayAlertVote = displayAlert
    ? classifyPollVote(displayAlert.message)
    : null;
  const displayAlertText = displayAlert
    ? stripVoteTagForSpeech(displayAlert.message) || displayAlert.message
    : "";

  return (
    <div className="relative w-screen h-screen bg-transparent overflow-hidden select-none flex flex-col justify-between p-4 sm:p-8 group">
      {/* Top Status Bar: Hidden during live OBS capture, shown on hover, ?preview=1, or Edit Layout */}
      <div
        className={`relative z-30 flex flex-wrap items-center justify-between gap-2 text-xs transition-opacity duration-300 ${
          isPreviewMode || isEditLayout
            ? "opacity-95"
            : "opacity-0 group-hover:opacity-100"
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

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              persistLayout({ ...layout, showQrWidget: !layout.showQrWidget })
            }
            className={`px-3.5 py-1.5 rounded-full font-bold text-[11px] shadow-lg transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
              layout.showQrWidget
                ? "bg-[#14F195] text-[#090A0F]"
                : "bg-black/80 hover:bg-black text-zinc-200 border border-white/15"
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>{layout.showQrWidget ? "Hide Scan QR" : "Show Scan QR"}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsEditLayout((prev) => !prev);
              setIsEditingGoalText(false);
            }}
            className={`px-3.5 py-1.5 rounded-full font-bold text-[11px] shadow-lg transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
              isEditLayout
                ? "bg-[#9945FF] text-white"
                : "bg-black/80 hover:bg-black text-zinc-200 border border-white/15"
            }`}
          >
            {isEditLayout ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Done Editing</span>
              </>
            ) : (
              <>
                <Move className="w-3.5 h-3.5" />
                <span>Customize Layout</span>
              </>
            )}
          </button>

          {isEditLayout && (
            <button
              type="button"
              onClick={() => {
                persistLayout(DEFAULT_OVERLAY_LAYOUT);
                setIsEditingGoalText(false);
              }}
              className="px-3 py-1.5 rounded-full bg-black/80 hover:bg-black text-zinc-300 border border-white/15 font-semibold text-[11px] shadow-lg transition-colors cursor-pointer inline-flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}

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
      </div>

      {/* CENTER REAL-TIME ALERT POPUP (Movable in Customize Layout mode) */}
      <div className="flex-1 flex items-center justify-center">
        {displayAlert && (
          <div
            key={displayAlert.id}
            onMouseDown={(e) => startWidgetDrag("alertPos", e)}
            onDoubleClick={() => setIsEditLayout(true)}
            style={{
              transform: `translate(${layout.alertPos.x}px, ${layout.alertPos.y}px)`,
            }}
            className={`relative animate-bounce-short w-full max-w-2xl ${
              isEditLayout
                ? "cursor-move ring-2 ring-dashed ring-[#14F195]/80 rounded-3xl"
                : ""
            }`}
          >
            {isEditLayout && (
              <div className="absolute -top-7 left-3 z-20 px-2.5 py-0.5 rounded-full bg-[#14F195] text-[#090A0F] text-[10px] font-black uppercase tracking-wider inline-flex items-center gap-1 shadow">
                <Move className="w-3 h-3" />
                <span>Drag Alert Card</span>
              </div>
            )}
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
                    <GiftIcon tier={displayAlert.tier} size="lg" />

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span
                          className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider text-[#090A0F]"
                          style={{ backgroundColor: activeStyle.border }}
                        >
                          {activeStyle.name} Tier
                        </span>
                        {displayAlert.donor && (
                          <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 font-mono text-[10px] text-zinc-300">
                            {displayAlert.donor.slice(0, 4)}...
                            {displayAlert.donor.slice(-4)}
                          </span>
                        )}
                      </div>

                      <h2 className="font-display text-2xl font-bold text-white tracking-tight truncate">
                        {displayAlert.displayName}
                      </h2>
                    </div>
                  </div>

                  {/* Amount & Live USD */}
                  <div className="text-right flex-shrink-0">
                    <div className="font-mono tabular-nums text-2xl sm:text-3xl font-black text-[#14F195]">
                      +{displayAlert.amountSol.toFixed(3)} SOL
                    </div>
                    {solUsdPrice && (
                      <div className="font-mono tabular-nums text-xs text-zinc-400">
                        ≈ ${(displayAlert.amountSol * solUsdPrice).toFixed(2)} USD
                      </div>
                    )}
                  </div>
                </div>

                {/* Message Box + Animated Voice Waveform */}
                <div className="flex items-center gap-4 bg-black/50 border border-white/10 rounded-2xl p-4">
                  <div className="flex-1 space-y-1">
                    {displayAlertVote && (
                      <span className="inline-block px-2 py-0.5 rounded-md bg-[#9945FF]/25 border border-[#9945FF]/50 text-[10px] font-bold uppercase tracking-wider text-white">
                        Voted Option {displayAlertVote}
                      </span>
                    )}
                    <p className="text-base text-white font-medium leading-snug">
                      &ldquo;{displayAlertText}&rdquo;
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <div className="flex items-end gap-1 h-6">
                      <span className="w-1.5 h-3 bg-[#E031E0] rounded-full animate-pulse" />
                      <span className="w-1.5 h-5 bg-[#00F0FF] rounded-full animate-pulse delay-75" />
                      <span className="w-1.5 h-6 bg-[#14F195] rounded-full animate-pulse delay-150" />
                      <span className="w-1.5 h-4 bg-[#9945FF] rounded-full animate-pulse delay-100" />
                      <span className="w-1.5 h-2 bg-[#00F0FF] rounded-full animate-pulse delay-200" />
                    </div>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-400">
                      {displayAlert.audioUrl ? "ElevenLabs AI" : "AI Voice"}
                    </span>
                  </div>
                </div>

                {/* Footer Verification Proof */}
                <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                  <span className="inline-flex items-center gap-1.5 text-[#14F195]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#14F195]" />
                    Verified on Solana Devnet
                  </span>
                  {!displayAlert.signature.includes("-replay-") && (
                    <span>
                      tx: {displayAlert.signature.slice(0, 6)}...
                      {displayAlert.signature.slice(-6)}
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
        {/* Live Goal Bar (Movable & Target Text Editable in Customize Layout mode) */}
        <div
          onMouseDown={(e) => startWidgetDrag("goalPos", e)}
          onDoubleClick={() => setIsEditLayout(true)}
          style={{
            transform: `translate(${layout.goalPos.x}px, ${layout.goalPos.y}px)`,
          }}
          className={`relative w-full max-w-md rounded-2xl bg-[#0F101A]/90 border border-white/10 p-4 backdrop-blur-md shadow-2xl ${
            isEditLayout ? "cursor-move ring-2 ring-dashed ring-[#9945FF]/80" : ""
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-xs font-bold mb-2">
            {isEditLayout && isEditingGoalText ? (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <input
                  type="text"
                  value={goalDraft}
                  maxLength={48}
                  autoFocus
                  onChange={(e) => setGoalDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      persistLayout({ ...layout, customGoalTitle: goalDraft });
                      setIsEditingGoalText(false);
                    } else if (e.key === "Escape") {
                      setIsEditingGoalText(false);
                    }
                  }}
                  placeholder={goal.title}
                  className="w-full px-2 py-0.5 rounded bg-black/70 border border-[#14F195]/60 text-white text-xs focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    persistLayout({ ...layout, customGoalTitle: goalDraft });
                    setIsEditingGoalText(false);
                  }}
                  className="px-2 py-0.5 rounded bg-[#14F195] text-[#090A0F] text-[10px] font-black cursor-pointer"
                >
                  Save
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-display text-white truncate">
                  {displayedGoalTitle}
                </span>
                {isEditLayout && (
                  <button
                    type="button"
                    onClick={() => {
                      setGoalDraft(displayedGoalTitle);
                      setIsEditingGoalText(true);
                    }}
                    title="Edit goal text"
                    className="p-1 rounded bg-white/10 hover:bg-white/20 text-zinc-200 cursor-pointer flex-shrink-0"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
            <span className="text-[#14F195] font-mono tabular-nums flex-shrink-0">
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

        {/* Live Micro-Vote Poll Widget (Draggable) */}
        {activePoll && activePoll.isActive && (() => {
          const totalVotes = activePoll.votesA + activePoll.votesB;
          const pctA = totalVotes > 0 ? Math.round((activePoll.votesA / totalVotes) * 100) : 50;
          const pctB = totalVotes > 0 ? 100 - pctA : 50;
          return (
            <div
              onMouseDown={(e) => startWidgetDrag("pollPos", e)}
              onDoubleClick={() => setIsEditLayout(true)}
              style={{
                transform: `translate(${layout.pollPos.x}px, ${layout.pollPos.y}px)`,
              }}
              className={`w-full max-w-sm rounded-2xl bg-[#0F101A]/90 border border-[#9945FF]/35 p-3.5 backdrop-blur-md shadow-2xl space-y-2 ${
                isEditLayout ? "cursor-move ring-2 ring-dashed ring-[#9945FF]/80" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
                <span className="inline-flex items-center gap-1.5 text-white truncate">
                  <Vote className="w-3.5 h-3.5 text-[#9945FF] flex-shrink-0" />
                  <span className="truncate">{activePoll.question}</span>
                </span>
                <span className="font-mono text-[#14F195] flex-shrink-0">
                  {totalVotes} vote{totalVotes === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="space-y-1">
                  <div className="flex justify-between text-zinc-200">
                    <span className="truncate">A·{activePoll.optionA}</span>
                    <span className="text-[#14F195]">{pctA}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-black/60 overflow-hidden">
                    <div
                      className="h-full bg-[#9945FF] transition-all duration-500"
                      style={{ width: `${Math.max(pctA, 4)}%` }}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-zinc-200">
                    <span className="truncate">B·{activePoll.optionB}</span>
                    <span className="text-[#00F0FF]">{pctB}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-black/60 overflow-hidden">
                    <div
                      className="h-full bg-[#14F195] transition-all duration-500"
                      style={{ width: `${Math.max(pctB, 4)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Scannable Solana Pay Mobile QR HUD (Toggleable & Draggable) */}
        {layout.showQrWidget && solanaPayQrValue && (
          <div
            onMouseDown={(e) => startWidgetDrag("qrPos", e)}
            onDoubleClick={() => setIsEditLayout(true)}
            style={{
              transform: `translate(${layout.qrPos.x}px, ${layout.qrPos.y}px)`,
            }}
            className={`rounded-2xl bg-[#0F101A]/95 border border-[#14F195]/40 p-2.5 backdrop-blur-md shadow-2xl flex items-center gap-2.5 flex-shrink-0 ${
              isEditLayout ? "cursor-move ring-2 ring-dashed ring-[#14F195]/80" : ""
            }`}
          >
            <div className="bg-white p-1.5 rounded-xl flex-shrink-0">
              <QRCodeSVG
                value={solanaPayQrValue}
                size={76}
                bgColor="#FFFFFF"
                fgColor="#0B0C10"
                level="L"
              />
            </div>
            <div className="pr-1 space-y-0.5 max-w-[110px]">
              <div className="text-[10px] font-black uppercase tracking-wider text-[#14F195]">
                Scan to Tip
              </div>
              <div className="text-[11px] font-bold text-white truncate">
                @{username}
              </div>
              <div className="text-[9px] text-zinc-400 leading-tight">
                Solana Pay · 0% cut
              </div>
            </div>
          </div>
        )}

        {/* Real-Time Latest Tipper HUD (Only renders when real tips exist on-chain) */}
        {latestTip && (
          <div
            onMouseDown={(e) => startWidgetDrag("supporterPos", e)}
            onDoubleClick={() => setIsEditLayout(true)}
            style={{
              transform: `translate(${layout.supporterPos.x}px, ${layout.supporterPos.y}px)`,
            }}
            className={`rounded-2xl bg-[#0F101A]/90 border border-white/10 px-4 py-3 backdrop-blur-md shadow-2xl flex items-center gap-3.5 max-w-sm ${
              isEditLayout ? "cursor-move ring-2 ring-dashed ring-[#00F0FF]/80" : ""
            }`}
          >
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

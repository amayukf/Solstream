"use client";

export interface CreatorProfile {
  username: string;
  authority: string; // Base58 public key
  voiceId: string;
  goalTitle: string;
  goalTargetLamports: number;
  goalCurrentLamports: number;
  bio?: string;
  createdAt: number;
}

export interface TipRecord {
  signature: string;
  donor: string;
  displayName: string;
  amountLamports: number;
  tier: number;
  message: string;
  timestamp: number;
}

const CREATORS_KEY = "solstream_creators";
const TIPS_PREFIX = "solstream_tips_";
const ACTIVE_HANDLE_KEY = "solstream_active_handle";

export function getStoredCreators(): Record<string, CreatorProfile> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(CREATORS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Failed to read creators from localStorage:", e);
    return {};
  }
}

export function getStoredCreator(username: string): CreatorProfile | null {
  if (!username) return null;
  const creators = getStoredCreators();
  return creators[username.toLowerCase()] || null;
}

export function getCreatorByWallet(authority: string): CreatorProfile | null {
  if (!authority) return null;
  const creators = getStoredCreators();
  return (
    Object.values(creators).find(
      (c) => c.authority.toLowerCase() === authority.toLowerCase()
    ) || null
  );
}

export function getActiveHandle(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_HANDLE_KEY);
}

export function setActiveHandle(username: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACTIVE_HANDLE_KEY, username.toLowerCase());
}

export function saveStoredCreator(profile: CreatorProfile): void {
  if (typeof window === "undefined") return;
  try {
    const creators = getStoredCreators();
    const cleanUsername = profile.username.toLowerCase();
    creators[cleanUsername] = {
      ...profile,
      username: cleanUsername,
    };
    localStorage.setItem(CREATORS_KEY, JSON.stringify(creators));
    setActiveHandle(cleanUsername);
  } catch (e) {
    console.error("Failed to save creator to localStorage:", e);
  }
}

export function getStoredTips(username: string): TipRecord[] {
  if (typeof window === "undefined" || !username) return [];
  try {
    const key = `${TIPS_PREFIX}${username.toLowerCase()}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Failed to read tips from localStorage:", e);
    return [];
  }
}

export function addStoredTip(username: string, tip: TipRecord): void {
  if (typeof window === "undefined" || !username) return;
  try {
    const cleanUsername = username.toLowerCase();
    const key = `${TIPS_PREFIX}${cleanUsername}`;
    const tips = getStoredTips(cleanUsername);
    // Avoid duplicate signatures
    if (!tips.some((t) => t.signature === tip.signature)) {
      tips.unshift(tip);
      localStorage.setItem(key, JSON.stringify(tips));
      // Dispatch storage event manually for same-tab listeners
      window.dispatchEvent(
        new CustomEvent("solstream_new_tip", {
          detail: { username: cleanUsername, tip },
        })
      );
      if (typeof BroadcastChannel !== "undefined") {
        try {
          const ch = new BroadcastChannel(`solstream_alerts_${cleanUsername}`);
          ch.postMessage(tip);
          ch.close();
        } catch {}
      }
    }
  } catch (e) {
    console.error("Failed to add tip to localStorage:", e);
  }
}

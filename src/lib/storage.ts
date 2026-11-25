"use client";

export interface CreatorProfile {
  username: string;
  authority: string; // Base58 public key
  voiceId: string;
  goalTitle: string;
  goalTargetLamports: number;
  goalCurrentLamports: number;
  totalTips?: number;
  totalVolume?: number;
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

export interface LeaderboardEntry {
  donorKey: string;
  displayName: string;
  totalLamports: number;
  count: number;
  latestSig: string;
  latestTimestamp: number;
}

const CREATORS_KEY = "solstream_creators";
const TIPS_PREFIX = "solstream_tips_";
const ACTIVE_HANDLE_KEY = "solstream_active_handle";

export const MAX_STORED_CREATORS = 50;
export const MAX_STORED_TIPS_PER_CREATOR = 100;
const PENDING_VERIFY_KEY = "solstream_pending_verify";
const MAX_PENDING_VERIFY = 50;
const PENDING_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingTipVerification {
  signature: string;
  username: string;
  createdAt: number;
  attempts: number;
}

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

/**
 * Caches a viewed creator profile locally (capped at 50 profiles) without changing active handle.
 */
export function cacheCreatorProfile(profile: CreatorProfile): void {
  if (typeof window === "undefined") return;
  try {
    const creators = getStoredCreators();
    const cleanUsername = profile.username.toLowerCase();
    creators[cleanUsername] = {
      ...profile,
      username: cleanUsername,
      createdAt: profile.createdAt || Date.now(),
    };

    const entries = Object.entries(creators);
    if (entries.length > MAX_STORED_CREATORS) {
      entries.sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
      while (entries.length > MAX_STORED_CREATORS) {
        const oldest = entries.shift();
        if (oldest && oldest[0] !== cleanUsername) {
          delete creators[oldest[0]];
        }
      }
    }

    localStorage.setItem(CREATORS_KEY, JSON.stringify(creators));
  } catch (e) {
    console.error("Failed to cache creator in localStorage:", e);
  }
}

/**
 * Saves a creator profile and updates active handle only when owned by the connected wallet.
 */
export function saveStoredCreator(
  profile: CreatorProfile,
  ownerWallet?: string | null
): void {
  if (typeof window === "undefined") return;
  cacheCreatorProfile(profile);
  if (
    ownerWallet &&
    profile.authority &&
    ownerWallet.toLowerCase() === profile.authority.toLowerCase()
  ) {
    setActiveHandle(profile.username.toLowerCase());
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
    // Avoid duplicate signatures and cap at 100 tips per creator
    if (!tips.some((t) => t.signature === tip.signature)) {
      tips.unshift(tip);
      if (tips.length > MAX_STORED_TIPS_PER_CREATOR) {
        tips.length = MAX_STORED_TIPS_PER_CREATOR;
      }
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

export function getPendingVerifications(): PendingTipVerification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PENDING_VERIFY_KEY);
    if (!raw) return [];
    const parsed: PendingTipVerification[] = JSON.parse(raw);
    const now = Date.now();
    return parsed.filter(
      (item) =>
        item &&
        typeof item.signature === "string" &&
        typeof item.username === "string" &&
        now - (item.createdAt || 0) < PENDING_VERIFY_TTL_MS
    );
  } catch {
    return [];
  }
}

export function enqueuePendingVerification(
  username: string,
  signature: string
): void {
  if (typeof window === "undefined" || !username || !signature) return;
  try {
    const list = getPendingVerifications().filter(
      (item) => item.signature !== signature
    );
    list.unshift({
      signature,
      username: username.toLowerCase(),
      createdAt: Date.now(),
      attempts: 0,
    });
    if (list.length > MAX_PENDING_VERIFY) list.length = MAX_PENDING_VERIFY;
    localStorage.setItem(PENDING_VERIFY_KEY, JSON.stringify(list));
  } catch (e) {
    console.error("Failed to enqueue pending tip verification:", e);
  }
}

export function removePendingVerification(signature: string): void {
  if (typeof window === "undefined" || !signature) return;
  try {
    const list = getPendingVerifications().filter(
      (item) => item.signature !== signature
    );
    localStorage.setItem(PENDING_VERIFY_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage error
  }
}

export function bumpPendingVerificationAttempt(
  signature: string,
  maxAttempts = 10
): void {
  if (typeof window === "undefined" || !signature) return;
  try {
    const list = getPendingVerifications()
      .map((item) =>
        item.signature === signature
          ? { ...item, attempts: (item.attempts || 0) + 1 }
          : item
      )
      .filter((item) => item.attempts < maxAttempts);
    localStorage.setItem(PENDING_VERIFY_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage error
  }
}

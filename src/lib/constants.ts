import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "BN6Zt6ctB4B5dTs8myMrq6CUp5Lea7jMitG9bp8cGKuA"
);

export const SOLANA_NETWORK = "devnet";
export const DEVNET_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

export interface GiftTier {
  id: number;
  name: string;
  emoji: string;
  amountSol: number;
  lamports: number;
  usdApprox: string;
  accentColor: string;
}

export const GIFT_TIERS: GiftTier[] = [
  {
    id: 0,
    name: "Coffee",
    emoji: "☕",
    amountSol: 0.005,
    lamports: 5_000_000,
    usdApprox: "~$1.00",
    accentColor: "#E2B77A",
  },
  {
    id: 1,
    name: "Rose",
    emoji: "🌹",
    amountSol: 0.01,
    lamports: 10_000_000,
    usdApprox: "~$2.00",
    accentColor: "#FF5E7E",
  },
  {
    id: 2,
    name: "Fire",
    emoji: "🔥",
    amountSol: 0.025,
    lamports: 25_000_000,
    usdApprox: "~$5.00",
    accentColor: "#FF8C00",
  },
  {
    id: 3,
    name: "Diamond",
    emoji: "💎",
    amountSol: 0.05,
    lamports: 50_000_000,
    usdApprox: "~$10.00",
    accentColor: "#00F0FF",
  },
  {
    id: 4,
    name: "Rocket",
    emoji: "🚀",
    amountSol: 0.1,
    lamports: 100_000_000,
    usdApprox: "~$20.00",
    accentColor: "#9945FF",
  },
  {
    id: 5,
    name: "Crown",
    emoji: "👑",
    amountSol: 0.25,
    lamports: 250_000_000,
    usdApprox: "~$50.00",
    accentColor: "#FFD700",
  },
];

export const MAX_DISPLAY_NAME_CHARS = 32;
export const MAX_MESSAGE_CHARS = 100;
export const MIN_TIP_LAMPORTS = 1_000_000; // 0.001 SOL

export const RESERVED_HANDLES = new Set([
  "claim",
  "dashboard",
  "overlay",
  "api",
  "actions",
  "actions.json",
  "_next",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "login",
  "signup",
  "admin",
  "settings",
  "solstream",
]);

export function isReservedHandle(username: string): boolean {
  return RESERVED_HANDLES.has(username.trim().toLowerCase());
}

/**
 * Maps any manual/custom SOL amount to one of the valid on-chain tiers (0..=5)
 * so custom amounts work seamlessly with the deployed Anchor program constraint.
 */
export function getTierForAmountSol(amountSol: number): GiftTier {
  const ordered = [...GIFT_TIERS].sort((a, b) => b.amountSol - a.amountSol);
  for (const tier of ordered) {
    if (amountSol >= tier.amountSol) return tier;
  }
  return GIFT_TIERS[0];
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: string;
  accent: string;
}

export const CURATED_VOICES: VoiceOption[] = [
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", gender: "Male", accent: "Deep & Narrative" },
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", gender: "Female", accent: "Warm & Clear" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", gender: "Female", accent: "Excited & Bright" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", gender: "Male", accent: "Energetic & Crisp" },
];

"use client";

import React from "react";

export type GiftVisualId = 0 | 1 | 2 | 3 | 4 | 5 | "custom";

interface GiftIconProps {
  tier: GiftVisualId | number;
  size?: "sm" | "md" | "lg";
  withBadge?: boolean;
  className?: string;
}

const BADGE_THEMES: Record<
  string,
  { bg: string; border: string; glow: string }
> = {
  "0": {
    bg: "from-[#3A2818] via-[#24180F] to-[#120D09]",
    border: "border-[#E2B77A]/40",
    glow: "shadow-[0_0_18px_rgba(226,183,122,0.22)]",
  },
  "1": {
    bg: "from-[#3F1326] via-[#260D19] to-[#13080E]",
    border: "border-[#FF5E7E]/45",
    glow: "shadow-[0_0_18px_rgba(255,94,126,0.24)]",
  },
  "2": {
    bg: "from-[#3E1D0B] via-[#261208] to-[#140A05]",
    border: "border-[#FF8C00]/45",
    glow: "shadow-[0_0_18px_rgba(255,140,0,0.26)]",
  },
  "3": {
    bg: "from-[#0C2F3D] via-[#0B1E2B] to-[#08121B]",
    border: "border-[#00F0FF]/45",
    glow: "shadow-[0_0_18px_rgba(0,240,255,0.28)]",
  },
  "4": {
    bg: "from-[#281448] via-[#19102E] to-[#0D0A1A]",
    border: "border-[#9945FF]/50",
    glow: "shadow-[0_0_20px_rgba(153,69,255,0.3)]",
  },
  "5": {
    bg: "from-[#3C2E09] via-[#241B07] to-[#130E05]",
    border: "border-[#FFD700]/50",
    glow: "shadow-[0_0_20px_rgba(255,215,0,0.3)]",
  },
  custom: {
    bg: "from-[#1A2A35] via-[#1B1434] to-[#0E101C]",
    border: "border-[#14F195]/45",
    glow: "shadow-[0_0_18px_rgba(20,241,149,0.25)]",
  },
};

function renderGiftSvg(key: string, iconDim: string) {
  switch (key) {
    case "0": // Coffee: Glowing Espresso Cup + Aroma Steam
      return (
        <svg viewBox="0 0 32 32" className={iconDim} fill="none">
          <defs>
            <linearGradient id="coffeeCupGrad" x1="5" y1="11" x2="23" y2="27" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FDE2B8" />
              <stop offset="0.5" stopColor="#E2B77A" />
              <stop offset="1" stopColor="#B87333" />
            </linearGradient>
            <linearGradient id="coffeeSteamGrad" x1="12" y1="3" x2="18" y2="10" gradientUnits="userSpaceOnUse">
              <stop stopColor="#14F195" />
              <stop offset="1" stopColor="#FDE2B8" />
            </linearGradient>
          </defs>
          <path d="M11 8.5C11 6.5 13 6 12.5 4" stroke="url(#coffeeSteamGrad)" strokeWidth="2" strokeLinecap="round" />
          <path d="M16 8.5C16 6.2 18 5.8 17.5 3.5" stroke="url(#coffeeSteamGrad)" strokeWidth="2" strokeLinecap="round" />
          <path d="M7 12H22V19.5C22 23.642 18.642 27 14.5 27C10.358 27 7 23.642 7 19.5V12Z" fill="url(#coffeeCupGrad)" />
          <path d="M22 14H24.2C25.746 14 27 15.254 27 16.8C27 18.346 25.746 19.6 24.2 19.6H22" stroke="#E2B77A" strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="14.5" cy="12" rx="7.5" ry="2.2" fill="#5A3318" stroke="#FDE2B8" strokeWidth="1" />
          <path d="M10 17.5C10.8 20.5 12.5 22.8 14.8 23.5" stroke="white" strokeOpacity="0.45" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );

    case "1": // Rose: Neon Crystal Rose
      return (
        <svg viewBox="0 0 32 32" className={iconDim} fill="none">
          <defs>
            <linearGradient id="roseBloomGrad" x1="9" y1="4" x2="23" y2="18" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FF9EB5" />
              <stop offset="0.5" stopColor="#FF4F7B" />
              <stop offset="1" stopColor="#BE185D" />
            </linearGradient>
            <linearGradient id="roseStemGrad" x1="16" y1="17" x2="16" y2="28" gradientUnits="userSpaceOnUse">
              <stop stopColor="#14F195" />
              <stop offset="1" stopColor="#059669" />
            </linearGradient>
          </defs>
          <path d="M16 17V28" stroke="url(#roseStemGrad)" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M16 23C12 23 10 21 10 18.5C12.5 18.5 14.8 20 16 22Z" fill="#14F195" fillOpacity="0.85" />
          <path d="M16 24.5C19.8 24.5 21.8 22.8 22 20.4C19.5 20.4 17.2 21.8 16 23.5Z" fill="#10B981" />
          <path d="M10 10C10 6.5 13 4.5 16 4.5C19 4.5 22 6.5 22 10C22 14.2 19.3 17.5 16 17.5C12.7 17.5 10 14.2 10 10Z" fill="url(#roseBloomGrad)" />
          <path d="M12.5 9.5C12.5 7.7 14 6.5 16 6.5C18 6.5 19.5 7.7 19.5 9.5C19.5 11.4 17.9 12.8 16 12.8C14.1 12.8 12.5 11.4 12.5 9.5Z" fill="#FFD1DC" fillOpacity="0.45" />
          <path d="M14.2 9.4C14.8 8.6 16.5 8.5 17.4 9.3C18 10 17.4 11.2 16 11.4" stroke="#FFF0F3" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );

    case "2": // Fire: Multi-layered Solana Blaze
      return (
        <svg viewBox="0 0 32 32" className={iconDim} fill="none">
          <defs>
            <linearGradient id="fireOuterGrad" x1="16" y1="3" x2="16" y2="28" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFE14D" />
              <stop offset="0.45" stopColor="#FF8C00" />
              <stop offset="1" stopColor="#EF4444" />
            </linearGradient>
            <linearGradient id="fireCoreGrad" x1="16" y1="13" x2="16" y2="27" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFFFFF" />
              <stop offset="1" stopColor="#FFE14D" />
            </linearGradient>
          </defs>
          <path
            d="M17.2 3.5C17.2 3.5 22.8 8.4 22.8 14.2C22.8 15.2 22.6 16.2 22.2 17C23.5 16 24.4 14.3 24.5 12.6C26.2 14.8 26.8 17.5 26 20.5C24.7 25.1 20.7 28 16 28C10.5 28 6.5 23.9 6.5 18.6C6.5 13.7 10.1 10.6 12.3 8.4C13.7 7 15.6 5.2 17.2 3.5Z"
            fill="url(#fireOuterGrad)"
          />
          <path
            d="M16.2 13C16.2 13 19.8 15.8 19.8 19.6C19.8 22.5 17.9 25 15.5 25C13.1 25 11.4 22.8 11.4 20.3C11.4 17.6 13.8 15.2 16.2 13Z"
            fill="url(#fireCoreGrad)"
          />
        </svg>
      );

    case "3": // Diamond: Faceted Cyber Gem
      return (
        <svg viewBox="0 0 32 32" className={iconDim} fill="none">
          <defs>
            <linearGradient id="diamondTopGrad" x1="6" y1="6" x2="26" y2="14" gradientUnits="userSpaceOnUse">
              <stop stopColor="#E0FFFF" />
              <stop offset="0.5" stopColor="#00F0FF" />
              <stop offset="1" stopColor="#38BDF8" />
            </linearGradient>
            <linearGradient id="diamondBotGrad" x1="4" y1="13" x2="28" y2="27" gradientUnits="userSpaceOnUse">
              <stop stopColor="#22D3EE" />
              <stop offset="0.5" stopColor="#0EA5E9" />
              <stop offset="1" stopColor="#6366F1" />
            </linearGradient>
          </defs>
          <polygon points="9.5,6 22.5,6 28,13 4,13" fill="url(#diamondTopGrad)" />
          <polygon points="4,13 28,13 16,27.5" fill="url(#diamondBotGrad)" />
          <polygon points="11.5,13 20.5,13 16,27.5" fill="#A5F3FC" fillOpacity="0.45" />
          <polygon points="12,6 20,6 20.5,13 11.5,13" fill="#FFFFFF" fillOpacity="0.4" />
          <circle cx="24.5" cy="7.5" r="1.3" fill="#FFFFFF" />
        </svg>
      );

    case "4": // Rocket: Cyber Rocket with Solana Plasma Exhaust
      return (
        <svg viewBox="0 0 32 32" className={iconDim} fill="none">
          <defs>
            <linearGradient id="rocketBodyGrad" x1="11" y1="5" x2="25" y2="21" gradientUnits="userSpaceOnUse">
              <stop stopColor="#F5F3FF" />
              <stop offset="0.55" stopColor="#C084FC" />
              <stop offset="1" stopColor="#9945FF" />
            </linearGradient>
            <linearGradient id="rocketFlameGrad" x1="5" y1="27" x2="12" y2="20" gradientUnits="userSpaceOnUse">
              <stop stopColor="#14F195" />
              <stop offset="1" stopColor="#00F0FF" />
            </linearGradient>
          </defs>
          <path d="M6.5 25.5L9.5 18.5L13.5 22.5L6.5 25.5Z" fill="url(#rocketFlameGrad)" />
          <path d="M12.5 12L7.5 13.5L10.5 18L12.5 12Z" fill="#9945FF" />
          <path d="M20 19.5L18.5 24.5L14 21.5L20 19.5Z" fill="#7C3AED" />
          <path
            d="M12.2 19.8C10.8 18.4 11.5 13.2 15.8 8.9C19.5 5.2 24.4 4.2 26.8 5.2C27.8 7.6 26.8 12.5 23.1 16.2C18.8 20.5 13.6 21.2 12.2 19.8Z"
            fill="url(#rocketBodyGrad)"
          />
          <circle cx="20" cy="12" r="2.7" fill="#0B0C10" stroke="#14F195" strokeWidth="1.5" />
        </svg>
      );

    case "5": // Crown: Sovereign Crown with Neon Gemstones
      return (
        <svg viewBox="0 0 32 32" className={iconDim} fill="none">
          <defs>
            <linearGradient id="crownGoldGrad" x1="4" y1="7" x2="28" y2="25" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFF099" />
              <stop offset="0.45" stopColor="#FFD700" />
              <stop offset="1" stopColor="#EA580C" />
            </linearGradient>
          </defs>
          <path
            d="M4.5 11L9.8 17.2L16 8L22.2 17.2L27.5 11L25.2 24H6.8L4.5 11Z"
            fill="url(#crownGoldGrad)"
          />
          <rect x="6.5" y="24" width="19" height="2.8" rx="1.4" fill="#F59E0B" />
          <circle cx="16" cy="7.5" r="2" fill="#00F0FF" />
          <circle cx="4.5" cy="10.5" r="1.7" fill="#9945FF" />
          <circle cx="27.5" cy="10.5" r="1.7" fill="#14F195" />
          <circle cx="16" cy="19.5" r="2" fill="#9945FF" stroke="#FFFBEB" strokeWidth="0.9" />
        </svg>
      );

    default: // Custom: Gradient Solana Custom Coin / Spark
      return (
        <svg viewBox="0 0 32 32" className={iconDim} fill="none">
          <defs>
            <linearGradient id="customSolGrad" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
              <stop stopColor="#9945FF" />
              <stop offset="0.5" stopColor="#00F0FF" />
              <stop offset="1" stopColor="#14F195" />
            </linearGradient>
          </defs>
          <circle cx="16" cy="16" r="11.5" fill="url(#customSolGrad)" fillOpacity="0.16" stroke="url(#customSolGrad)" strokeWidth="2" />
          <path d="M10.5 12H20.5L22 10H12L10.5 12Z" fill="url(#customSolGrad)" />
          <path d="M10.5 17H20.5L22 15H12L10.5 17Z" fill="url(#customSolGrad)" />
          <path d="M12 22H22L20.5 20H10.5L12 22Z" fill="url(#customSolGrad)" />
        </svg>
      );
  }
}

export const GiftIcon: React.FC<GiftIconProps> = ({
  tier,
  size = "md",
  withBadge = true,
  className = "",
}) => {
  const key = tier === "custom" ? "custom" : String(Math.min(Math.max(Number(tier) || 0, 0), 5));
  const theme = BADGE_THEMES[key] || BADGE_THEMES["0"];

  const boxClass =
    size === "sm"
      ? "w-7 h-7 rounded-lg"
      : size === "lg"
      ? "w-12 h-12 sm:w-14 sm:h-14 rounded-2xl"
      : "w-9 h-9 rounded-xl";

  const svgClass =
    size === "sm" ? "w-4 h-4" : size === "lg" ? "w-7 h-7 sm:w-8 sm:h-8" : "w-5 h-5";

  if (!withBadge) {
    return (
      <span className={`inline-flex items-center justify-center flex-shrink-0 ${className}`}>
        {renderGiftSvg(key, svgClass)}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 bg-gradient-to-br ${theme.bg} border ${theme.border} ${theme.glow} ${boxClass} ${className}`}
    >
      {renderGiftSvg(key, svgClass)}
    </span>
  );
};

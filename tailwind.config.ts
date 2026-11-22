import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: "#090A0F",
        surface: "#12131A",
        card: "#181924",
        "card-hover": "#212232",
        "solana-purple": "#9945FF",
        "solana-green": "#14F195",
        "solana-cyan": "#00F0FF",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
        "solana-gradient": "linear-gradient(135deg, #9945FF 0%, #14F195 100%)",
      },
      boxShadow: {
        "glow-purple": "0 0 25px -5px rgba(153, 69, 255, 0.35)",
        "glow-green": "0 0 25px -5px rgba(20, 241, 149, 0.35)",
      },
    },
  },
  plugins: [],
};
export default config;

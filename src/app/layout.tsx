import type { Metadata } from "next";
import { SolanaWalletProvider } from "@/components/SolanaWalletProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolStream | Real-Time Web3 Stream Monetization on Solana",
  description:
    "Direct on-chain tips in SOL with real-time AI voice stream alerts for creators and streamers worldwide.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-obsidian text-white min-h-screen antialiased selection:bg-solana-purple selection:text-white">
        <SolanaWalletProvider>{children}</SolanaWalletProvider>
      </body>
    </html>
  );
}

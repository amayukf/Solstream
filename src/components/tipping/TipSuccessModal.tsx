"use client";

import React, { useEffect } from "react";
import confetti from "canvas-confetti";
import { Check, ExternalLink } from "lucide-react";

interface TipSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  signature: string;
  amountSol: number;
  displayName: string;
  message: string;
  username?: string;
}

export default function TipSuccessModal({
  isOpen,
  onClose,
  signature,
  amountSol,
  username = "creator",
}: TipSuccessModalProps) {
  useEffect(() => {
    if (isOpen) {
      confetti({
        particleCount: 60,
        spread: 60,
        origin: { y: 0.6 },
        colors: ["#14F195", "#9945FF", "#00F0FF"],
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const shortSig = `${signature.slice(0, 4)}...${signature.slice(-4)}`;
  const solscanUrl = `https://solscan.io/tx/${signature}?cluster=devnet`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md rounded-3xl bg-[#13141F] border border-white/10 p-8 text-center shadow-2xl relative">
        {/* Large green check circle */}
        <div className="w-16 h-16 rounded-full bg-[#14F195] text-[#090A0F] flex items-center justify-center mx-auto mb-5 shadow-lg shadow-[#14F195]/20">
          <Check className="w-8 h-8 stroke-[3]" />
        </div>

        <h3 className="text-2xl font-black text-white tracking-tight mb-1.5">
          Tip sent to @{username}
        </h3>
        <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
          {amountSol} SOL went straight to their wallet. Your alert is on its
          way to their stream.
        </p>

        {/* 3 Checklist Items Card */}
        <div className="rounded-2xl bg-[#090A0F] border border-white/5 p-4 mb-5 text-left space-y-3.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-5 rounded-full bg-[#14F195] text-[#090A0F] flex items-center justify-center">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
              <span className="font-bold text-white">Confirmed on Solana</span>
            </div>
            <span className="text-[11px] font-mono text-zinc-500">send_tip</span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-5 rounded-full bg-[#14F195] text-[#090A0F] flex items-center justify-center">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
              <span className="font-bold text-white">
                Checked against the chain
              </span>
            </div>
            <span className="text-[11px] font-mono text-zinc-500">server</span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-5 rounded-full bg-[#14F195] text-[#090A0F] flex items-center justify-center">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
              <span className="font-bold text-white">
                Alert queued on the stream
              </span>
            </div>
            <span className="text-[11px] font-mono text-zinc-500">realtime</span>
          </div>
        </div>

        {/* Transaction hash card */}
        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[#090A0F] border border-white/5 mb-6 text-left">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              TRANSACTION
            </div>
            <div className="text-xs font-mono font-bold text-white">
              {shortSig}
            </div>
          </div>

          <a
            href={solscanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-1.5 rounded-xl bg-[#1A1B29] hover:bg-[#25263A] text-xs font-semibold text-zinc-300 border border-white/10 transition-colors"
          >
            View on Solscan
          </a>
        </div>

        {/* Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onClose}
            className="py-3.5 rounded-2xl bg-[#9945FF] hover:bg-[#8A37FF] text-white font-bold text-xs tracking-wide transition-all shadow-lg shadow-[#9945FF]/20"
          >
            Send another tip
          </button>
          <button
            onClick={onClose}
            className="py-3.5 rounded-2xl bg-[#1A1B29] hover:bg-[#25263A] text-zinc-300 font-bold text-xs border border-white/10 transition-colors"
          >
            Back to @{username}
          </button>
        </div>
      </div>
    </div>
  );
}

export { TipSuccessModal };

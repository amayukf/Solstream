"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";

export default function RootError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error("SolStream route error:", error);
  }, [error]);

  const message =
    error instanceof Error && error.message
      ? error.message
      : "An unexpected runtime error interrupted this page.";

  return (
    <div className="min-h-screen bg-[#0B0C10] text-[#E0E2EC] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-3xl bg-[#13141F] border border-white/10 p-8 text-center space-y-5 shadow-2xl">
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-extrabold text-white">
            Something went wrong
          </h1>
          <p className="text-xs text-zinc-400 leading-relaxed break-words">
            {message}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => retry()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#14F195] hover:bg-[#12DB87] text-[#090A0F] font-bold text-xs transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Try again</span>
          </button>
          <Link
            href="/"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 font-semibold text-xs transition-colors"
          >
            <Home className="w-3.5 h-3.5" />
            <span>Back home</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

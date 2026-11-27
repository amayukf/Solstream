import Link from "next/link";
import { SolanaLogo } from "@/components/SolanaLogo";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0B0C10] text-[#E0E2EC] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-3xl bg-[#13141F] border border-white/10 p-8 text-center space-y-5 shadow-2xl">
        <div className="flex items-center justify-center gap-2 text-zinc-400 text-xs font-mono uppercase tracking-widest">
          <SolanaLogo className="w-5 h-4" />
          <span>404 · Not Found</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold text-white">
            Route or Creator Not Found
          </h1>
          <p className="text-xs text-zinc-400 leading-relaxed">
            The SolStream page you requested does not exist or hasn&apos;t been
            claimed on Solana Devnet yet.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            href="/"
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 font-semibold text-xs transition-colors"
          >
            Back home
          </Link>
          <Link
            href="/claim"
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#14F195] hover:bg-[#12DB87] text-[#090A0F] font-bold text-xs transition-colors"
          >
            Claim a handle
          </Link>
        </div>
      </div>
    </div>
  );
}

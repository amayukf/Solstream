"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSolStreamProgram } from "@/hooks/useSolStreamProgram";
import { CURATED_VOICES, isReservedHandle } from "@/lib/constants";
import { saveStoredCreator } from "@/lib/storage";
import { SolanaLogo } from "@/components/SolanaLogo";
import { Check, Loader2, AlertCircle } from "lucide-react";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

function ClaimHandleForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { connected, publicKey } = useWallet();
  const {
    initializeCreator,
    getCreatorPda,
    fetchCreatorAccount,
    fetchHandleRegistry,
  } = useSolStreamProgram();

  const [handle, setHandle] = useState("");
  const [selectedVoice, setSelectedVoice] = useState(CURATED_VOICES[0].id);
  const [goalTitle, setGoalTitle] = useState("Mic upgrade");
  const [goalTarget, setGoalTarget] = useState("3.0");
  const [importUrl, setImportUrl] = useState("");
  const [isImportingProfile, setIsImportingProfile] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [existingOnChainHandle, setExistingOnChainHandle] = useState<string | null>(null);
  const [registeredHandles, setRegisteredHandles] = useState<Record<string, string>>({});
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [handleLookup, setHandleLookup] = useState<{
    handle: string;
    checking: boolean;
    authority: string | null;
    error: string | null;
  }>({
    handle: "",
    checking: false,
    authority: null,
    error: null,
  });

  useEffect(() => {
    fetch("/api/creators")
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`Directory lookup failed (${r.status})`);
        }
        return r.json();
      })
      .then((data) => {
        setDirectoryError(null);
        if (Array.isArray(data?.creators)) {
          const map: Record<string, string> = {};
          for (const c of data.creators) {
            if (c.username && c.authority) {
              map[c.username.toLowerCase()] = c.authority;
            }
          }
          setRegisteredHandles(map);
        }
      })
      .catch((err) => {
        setDirectoryError(err?.message || "Failed to load creator directory");
      });
  }, []);

  const cleanHandle = handle.trim().toLowerCase();
  const isHandleReserved = Boolean(cleanHandle && isReservedHandle(cleanHandle));

  // Check both on-chain HandleRegistry PDA and chain+DB creator API whenever cleanHandle changes
  useEffect(() => {
    if (!cleanHandle || isReservedHandle(cleanHandle)) {
      const resetTimer = setTimeout(() => {
        setHandleLookup({
          handle: cleanHandle,
          checking: false,
          authority: null,
          error: null,
        });
      }, 0);
      return () => clearTimeout(resetTimer);
    }

    let cancelled = false;
    const startTimer = setTimeout(() => {
      if (!cancelled) {
        setHandleLookup({
          handle: cleanHandle,
          checking: true,
          authority: null,
          error: null,
        });
      }
    }, 0);

    const timer = setTimeout(async () => {
      const [registryRes, apiRes] = await Promise.allSettled([
        fetchHandleRegistry(cleanHandle),
        fetch(`/api/creators/${encodeURIComponent(cleanHandle)}`, {
          cache: "no-store",
        }).then(async (r) => {
          if (r.status === 404) return null;
          if (!r.ok) throw new Error(`API handle check failed (${r.status})`);
          const data = await r.json();
          return data?.found && data?.creator?.authority
            ? String(data.creator.authority)
            : null;
        }),
      ]);

      if (cancelled) return;

      const chainAuthority =
        registryRes.status === "fulfilled" ? registryRes.value?.authority || null : null;
      const apiAuthority =
        apiRes.status === "fulfilled" ? apiRes.value || null : null;
      const resolvedAuthority = chainAuthority || apiAuthority;

      const lookupFailed =
        !resolvedAuthority &&
        (registryRes.status === "rejected" || apiRes.status === "rejected");

      setHandleLookup({
        handle: cleanHandle,
        checking: false,
        authority: resolvedAuthority,
        error: lookupFailed
          ? "Could not verify handle availability on Solana & Supabase"
          : null,
      });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      clearTimeout(timer);
    };
  }, [cleanHandle, fetchHandleRegistry]);

  const onChainOrApiHandleOwner =
    handleLookup.handle === cleanHandle ? handleLookup.authority : null;
  const handleLookupError =
    handleLookup.handle === cleanHandle
      ? handleLookup.error || (!onChainOrApiHandleOwner && directoryError ? directoryError : null)
      : null;
  const isCheckingHandle =
    Boolean(cleanHandle) &&
    !isHandleReserved &&
    handleLookup.handle === cleanHandle &&
    handleLookup.checking;

  const handleOwner = cleanHandle
    ? onChainOrApiHandleOwner || registeredHandles[cleanHandle]
    : undefined;
  const isHandleTakenByOther = Boolean(
    handleOwner && (!publicKey || handleOwner !== publicKey.toBase58())
  );
  const isHandleOwnedBySelf = Boolean(
    handleOwner && publicKey && handleOwner === publicKey.toBase58()
  );

  useEffect(() => {
    const queryHandle = searchParams?.get("handle");
    if (!queryHandle) return;
    const normalized = queryHandle.toLowerCase().replace(/[^a-z0-9_]/g, "");
    const timer = setTimeout(() => {
      setHandle(normalized);
    }, 0);
    return () => clearTimeout(timer);
  }, [searchParams]);

  // Check if wallet already has an on-chain account
  useEffect(() => {
    async function checkExisting() {
      if (!publicKey) {
        setExistingOnChainHandle(null);
        return;
      }
      try {
        const pda = getCreatorPda(publicKey);
        const acc = await fetchCreatorAccount(pda);
        if (acc && acc.username) {
          const targetRaw = acc.goalTargetLamports ?? acc.goal_target_lamports;
          const currentRaw = acc.goalCurrentLamports ?? acc.goal_current_lamports;
          const targetLamports =
            typeof targetRaw === "number"
              ? targetRaw
              : targetRaw?.toNumber
              ? targetRaw.toNumber()
              : 3_000_000_000;
          const currentLamports =
            typeof currentRaw === "number"
              ? currentRaw
              : currentRaw?.toNumber
              ? currentRaw.toNumber()
              : 0;

          const uname = acc.username.toLowerCase();
          setExistingOnChainHandle(uname);
          setHandle((prev) => prev || uname);

          saveStoredCreator(
            {
              username: uname,
              authority: publicKey.toBase58(),
              voiceId: acc.voiceId || acc.voice_id || CURATED_VOICES[0].id,
              goalTitle: acc.goalTitle || acc.goal_title || "Stream Goal",
              goalTargetLamports: targetLamports,
              goalCurrentLamports: currentLamports,
              createdAt: Date.now(),
            },
            publicKey.toBase58()
          );
        }
      } catch (e) {
        console.log("No existing profile found:", e);
      }
    }
    checkExisting();
  }, [publicKey, getCreatorPda, fetchCreatorAccount]);

  const handleImportChannel = async () => {
    const targetUrl = importUrl.trim();
    if (!targetUrl) return;
    setIsImportingProfile(true);
    setImportStatus(null);
    try {
      const res = await fetch("/api/creators/import-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setImportStatus(data?.error || "Could not import channel details.");
        return;
      }
      if (data?.suggestedHandle && !existingOnChainHandle) {
        setHandle(String(data.suggestedHandle));
      }
      if (data?.suggestedGoal) {
        setGoalTitle(String(data.suggestedGoal));
      }
      setImportStatus(
        `Imported from ${data?.title || targetUrl} via Firecrawl.`
      );
    } catch {
      setImportStatus("Failed to reach channel importer.");
    } finally {
      setIsImportingProfile(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !publicKey) {
      setError("Please connect your Phantom wallet first.");
      return;
    }
    if (!cleanHandle) {
      setError("Please enter a valid handle.");
      return;
    }
    if (isReservedHandle(cleanHandle)) {
      setError(`@${cleanHandle} is a reserved platform handle. Choose a different handle.`);
      return;
    }
    if (isHandleTakenByOther) {
      setError(`@${cleanHandle} is already claimed on Devnet by another wallet. Choose a different handle.`);
      return;
    }
    const cleanGoalTitle = goalTitle.trim() || "Stream Goal";
    if (new TextEncoder().encode(cleanGoalTitle).length > 64) {
      setError("Goal title exceeds the 64-byte on-chain UTF-8 limit.");
      return;
    }
    const targetNum = parseFloat(goalTarget);
    if (isNaN(targetNum) || targetNum < 0.01) {
      setError("Goal target must be at least 0.01 SOL.");
      return;
    }
    setError(null);
    setIsLoading(true);

    try {
      // Fresh chain + DB handle availability check before submitting transaction
      const [registryRes, apiRes] = await Promise.allSettled([
        fetchHandleRegistry(cleanHandle),
        fetch(`/api/creators/${encodeURIComponent(cleanHandle)}`, {
          cache: "no-store",
        }).then(async (r) => {
          if (r.status === 404) return null;
          if (!r.ok) throw new Error(`API handle check failed (${r.status})`);
          const data = await r.json();
          return data?.found && data?.creator?.authority
            ? String(data.creator.authority)
            : null;
        }),
      ]);

      const latestOwner =
        (registryRes.status === "fulfilled" ? registryRes.value?.authority : null) ||
        (apiRes.status === "fulfilled" ? apiRes.value : null);

      if (latestOwner && latestOwner !== publicKey.toBase58()) {
        setError(`@${cleanHandle} is already registered to another wallet.`);
        setIsLoading(false);
        return;
      }

      if (
        !latestOwner &&
        (registryRes.status === "rejected" || apiRes.status === "rejected")
      ) {
        setError("Could not verify handle availability right now. Please try again.");
        setIsLoading(false);
        return;
      }

      const lamports = Math.round(targetNum * 1_000_000_000);

      // Call Anchor on-chain initialize_creator with trimmed values
      await initializeCreator(cleanHandle, selectedVoice, lamports, cleanGoalTitle);

      // Save real creator profile to localStorage
      saveStoredCreator(
        {
          username: cleanHandle,
          authority: publicKey.toBase58(),
          voiceId: selectedVoice,
          goalTitle: cleanGoalTitle,
          goalTargetLamports: lamports,
          goalCurrentLamports: 0,
          createdAt: Date.now(),
        },
        publicKey.toBase58()
      );

      // Sync creator PDA into Supabase Postgres
      const regRes = await fetch("/api/creators/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: publicKey.toBase58() }),
      }).catch(() => null);

      if (regRes && regRes.status === 409) {
        const regErr = await regRes.json().catch(() => null);
        setError(regErr?.error || `@${cleanHandle} conflicts with an existing handle.`);
        setIsLoading(false);
        return;
      }

      // Redirect to creator dashboard
      router.push("/dashboard");
    } catch (err: any) {
      console.error(err);
      const errMsg = err?.message || String(err);
      if (
        errMsg.includes("0x0") ||
        errMsg.includes("already in use") ||
        errMsg.includes("AccountAlreadyInUse")
      ) {
        const ownAcc = await fetchCreatorAccount(getCreatorPda(publicKey)).catch(
          () => null
        );
        if (ownAcc && ownAcc.username) {
          saveStoredCreator(
            {
              username: String(ownAcc.username).toLowerCase(),
              authority: publicKey.toBase58(),
              voiceId: ownAcc.voiceId || ownAcc.voice_id || selectedVoice,
              goalTitle: ownAcc.goalTitle || ownAcc.goal_title || cleanGoalTitle,
              goalTargetLamports: Math.round(targetNum * 1_000_000_000),
              goalCurrentLamports: 0,
              createdAt: Date.now(),
            },
            publicKey.toBase58()
          );
          await fetch("/api/creators/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ walletAddress: publicKey.toBase58() }),
          }).catch(() => {});
          router.push("/dashboard");
        } else {
          setError(
            `@${cleanHandle} was just claimed by another wallet on Solana Devnet. Choose a different handle.`
          );
        }
      } else {
        setError(errMsg || "Failed to initialize creator profile on Solana Devnet.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
      {/* Left Column: Heading & Stepper */}
      <div className="lg:col-span-5 space-y-6">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
          Set up your creator profile
        </h1>
        <p className="text-sm text-zinc-400 leading-relaxed">
          One transaction creates your profile on Solana. Your handle, voice
          and goal live on-chain, so nobody can change them but you.
        </p>

        {/* Stepper */}
        <div className="space-y-4 pt-4">
          <div className="flex items-center gap-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              connected ? "bg-[#14F195] text-[#090A0F]" : "bg-[#1A1B29] text-zinc-500 border border-white/10"
            }`}>
              {connected ? <Check className="w-3.5 h-3.5" /> : "1"}
            </div>
            <span className={`text-sm font-semibold ${connected ? "text-white" : "text-zinc-500"}`}>
              {connected ? "Wallet connected" : "Connect Phantom wallet"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-[#9945FF] text-white flex items-center justify-center text-xs font-bold shadow-lg shadow-[#9945FF]/30">
              2
            </div>
            <span className="text-sm font-semibold text-white">
              Handle, voice and goal
            </span>
          </div>

          <div className="flex items-center gap-3 text-zinc-500">
            <div className="w-6 h-6 rounded-full bg-[#1A1B29] border border-white/10 flex items-center justify-center text-xs font-bold">
              3
            </div>
            <span className="text-sm font-medium">Sign on Devnet</span>
          </div>

          <div className="flex items-center gap-3 text-zinc-500">
            <div className="w-6 h-6 rounded-full bg-[#1A1B29] border border-white/10 flex items-center justify-center text-xs font-bold">
              4
            </div>
            <span className="text-sm font-medium">Copy your OBS link</span>
          </div>
        </div>
      </div>

      {/* Right Column: Setup Form */}
      <div className="lg:col-span-7 space-y-4">
        {existingOnChainHandle && (
          <div className="p-4 rounded-2xl bg-[#14F195]/10 border border-[#14F195]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-[#14F195]">
              <strong>Profile Already Active:</strong> This wallet already owns{" "}
              <span className="font-mono font-bold">@{existingOnChainHandle}</span> on Devnet.
            </div>
            <Link
              href="/dashboard"
              className="px-4 py-2 rounded-xl bg-[#14F195] text-[#090A0F] font-bold text-xs text-center flex-shrink-0"
            >
              Open Creator Studio →
            </Link>
          </div>
        )}
        <form
          onSubmit={handleCreate}
          className="rounded-3xl bg-[#13141F] border border-white/10 p-7 md:p-9 space-y-6 shadow-2xl"
        >
          {/* Optional Firecrawl Channel Auto-Fill */}
          <div className="rounded-2xl bg-[#090A0F] border border-white/10 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-bold text-zinc-300">
              <span>Quick-fill from channel URL (Firecrawl)</span>
              <span className="text-[10px] font-mono text-zinc-500">Optional</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="url"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://twitch.tv/yourchannel or youtube.com/@handle"
                className="flex-1 bg-[#13141F] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#14F195]"
              />
              <button
                type="button"
                onClick={handleImportChannel}
                disabled={isImportingProfile || !importUrl.trim()}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-white transition-colors disabled:opacity-50"
              >
                {isImportingProfile ? "Importing..." : "Auto-fill"}
              </button>
            </div>
            {importStatus && (
              <p className="text-[11px] text-[#14F195]">{importStatus}</p>
            )}
          </div>

          {/* Handle Field */}
          <div>
            <label className="block text-xs font-bold text-zinc-300 mb-2">
              Your handle
            </label>
            <div className="flex items-center bg-[#090A0F] rounded-2xl border border-white/10 px-4 py-3 focus-within:border-[#9945FF] transition-all">
              <span className="text-zinc-500 font-mono text-sm select-none">
                solstream.app/
              </span>
              <input
                type="text"
                value={handle}
                onChange={(e) =>
                  setHandle(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_]/g, "")
                  )
                }
                maxLength={32}
                className="flex-1 bg-transparent text-white font-semibold text-sm focus:outline-none"
                required
              />
              {cleanHandle && (
                <span
                  className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                    isHandleReserved
                      ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
                      : isCheckingHandle
                      ? "text-zinc-300 bg-white/5 border-white/10"
                      : isHandleTakenByOther
                      ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
                      : isHandleOwnedBySelf
                      ? "text-[#14F195] bg-[#14F195]/10 border-[#14F195]/20"
                      : handleLookupError
                      ? "text-amber-300 bg-amber-500/10 border-amber-500/20"
                      : "text-[#14F195] bg-[#14F195]/10 border-[#14F195]/20"
                  }`}
                >
                  {isHandleReserved
                    ? "Reserved"
                    : isCheckingHandle
                    ? "Checking..."
                    : isHandleTakenByOther
                    ? "Taken"
                    : isHandleOwnedBySelf
                    ? "Owned by you"
                    : handleLookupError
                    ? "Check failed"
                    : "Available"}
                </span>
              )}
            </div>
            <span className="block text-[11px] text-zinc-500 mt-1.5">
              Lowercase letters, numbers and underscore · 1 to 32 characters
            </span>
            {isHandleReserved && (
              <span className="block text-[11px] text-rose-400 mt-1">
                &quot;@{cleanHandle}&quot; is a reserved platform handle. Please choose another.
              </span>
            )}
            {handleLookupError && !isHandleReserved && !isHandleTakenByOther && !isHandleOwnedBySelf && (
              <span className="block text-[11px] text-amber-300 mt-1">
                {handleLookupError}
              </span>
            )}
          </div>

          {/* Alert Voice */}
          <div>
            <label className="block text-xs font-bold text-zinc-300 mb-2">
              Alert voice
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {CURATED_VOICES.map((v) => {
                const isSelected = selectedVoice === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVoice(v.id)}
                    className={`p-3.5 rounded-2xl text-left transition-all ${
                      isSelected
                        ? "bg-[#1E1838] border-2 border-[#9945FF] shadow-lg shadow-[#9945FF]/20"
                        : "bg-[#090A0F] border border-white/10 hover:border-white/20"
                    }`}
                  >
                    <div className="text-sm font-bold text-white mb-0.5">
                      {v.name}
                    </div>
                    <div className="text-xs text-zinc-400">
                      {v.gender} · {v.accent}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stream Goal & Target */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-8">
              <label className="block text-xs font-bold text-zinc-300 mb-2">
                First stream goal
              </label>
              <input
                type="text"
                value={goalTitle}
                onChange={(e) => setGoalTitle(e.target.value)}
                maxLength={64}
                className="w-full bg-[#090A0F] border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#9945FF]"
                required
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block text-xs font-bold text-zinc-300 mb-2">
                Target (SOL)
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                value={goalTarget}
                onChange={(e) => setGoalTarget(e.target.value)}
                className="w-full bg-[#090A0F] border border-white/10 rounded-2xl px-4 py-3 text-sm text-white font-mono focus:outline-none focus:border-[#9945FF]"
                required
              />
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Bottom Note & Submit Button */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-zinc-500 max-w-sm">
              Signs one transaction. A small one-time rent deposit for the
              profile account is paid from your wallet.
            </p>

            {!connected ? (
              <WalletMultiButton className="!bg-[#14F195] !text-[#090A0F] !font-black !text-sm !rounded-2xl !h-12 !px-6" />
            ) : (
              <button
                type="submit"
                disabled={isLoading || isHandleTakenByOther || isHandleReserved}
                className="w-full sm:w-auto px-7 py-3.5 rounded-2xl bg-[#14F195] hover:bg-[#12DB87] text-[#090A0F] font-black text-sm tracking-wide transition-all shadow-lg shadow-[#14F195]/20 flex items-center justify-center gap-2 flex-shrink-0 disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#090A0F]" />
                    <span>Signing on Solana Devnet...</span>
                  </>
                ) : (
                  <span>Create profile on Solana</span>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ClaimHandlePage() {
  const { connected } = useWallet();

  return (
    <div className="min-h-screen bg-[#0B0C10] text-[#E0E2EC] overflow-x-clip">
      {/* Top Bar */}
      <header className="relative z-50 w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5">
          <SolanaLogo className="w-6 h-5" />
          <span className="text-xl font-bold tracking-tight text-white">
            SolStream
          </span>
        </Link>

        <div className="flex items-center gap-2">
          {connected && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#13141F] border border-white/10 text-[11px] font-mono text-zinc-400">
              <span className="w-1.5 h-1.5 rounded-full bg-[#14F195]" />
              Devnet
            </span>
          )}
          <WalletMultiButton className="!bg-[#1D1B2E] !text-white !font-semibold !text-xs !rounded-xl !h-10 !px-4 !border !border-white/10" />
        </div>
      </header>

      {/* Main Setup Content wrapped in Suspense */}
      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Suspense fallback={<div className="text-center py-20 text-zinc-500">Loading profile setup...</div>}>
          <ClaimHandleForm />
        </Suspense>
      </main>
    </div>
  );
}

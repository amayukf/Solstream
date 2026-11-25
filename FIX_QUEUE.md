# SolStream Fix Queue

## Rules
- Work on one unchecked task at a time, in order.
- Read the relevant files before editing. Do not refactor unrelated code.
- After each task: run `npx tsc --noEmit --incremental false`.
- If typecheck passes: mark the task `[x]`, commit with a descriptive message, and stop (unless told to continue).
- If typecheck fails or you need a deployment, secret, or destructive action: stop and report.
- Do not deploy/upgrade the Solana program. Do not run migrations against hosted Supabase.
- Never print or commit secrets from `.env.local`.

## [x] Fix 2 — OBS overlay
Files: `src/app/overlay/[username]/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`.
- Split queue processing from the 7s dismiss timer and 220ms audio timer.
- Key timers to `currentAlert?.id`; setting `currentAlert`/`queue` must not clear the dismiss timer.
- Remove queue items by matching `id`, not `slice(1)`.
- Make the overlay route’s `html`/`body` transparent on mount; restore on unmount.
- Use one shared `AudioContext`; resume it; disconnect nodes on end.
- Cap `audioBySig`, `seenSigs`, `playedAudioSigs`; clean up Audio elements.
- Keep SSE, Supabase Realtime, BroadcastChannel, replay, and preview working.
Acceptance: 3 rapid tips display sequentially, each ~7s; overlay transparent in OBS; one AudioContext; typecheck passes.

## [x] Fix 3 — Unique usernames on-chain
Files: `programs/solstream/src/lib.rs`, `src/idl/solstream.json`, `src/hooks/useSolStreamProgram.ts`, `src/app/claim/page.tsx`, `tests/solstream.ts`.
- Add `HandleRegistry { authority: Pubkey, bump: u8 }`.
- Add `handle_registry` to `InitializeCreator` with seeds `[b"handle", username.as_bytes()]`, `init`, payer authority.
- Add `register_existing_handle` for legacy creators; authority signs; verify existing CreatorAccount.
- Add `getHandlePda(username)`; pass registry account in `initializeCreator`; add `registerExistingHandle`.
- Claim page checks handle PDA on-chain, not only `/api/creators`.
- Update IDL. If Anchor build is unavailable, compute discriminators as first 8 bytes of SHA256("account:HandleRegistry") and SHA256("global:register_existing_handle").
- Add duplicate-handle and migration tests.
- Do not deploy; add a migration/runbook.
Acceptance: second wallet cannot claim same handle; legacy creator can register once; IDL/client consistent; typecheck passes.

## [x] Fix 4 — Chain-first reads
Files: `src/app/api/creators/[username]/route.ts`, `src/app/api/creators/route.ts`, `src/app/api/creators/register/route.ts`, `src/lib/supabaseDb.ts`, `src/app/claim/page.tsx`.
- Fetch on-chain CreatorAccount even when a DB row exists; sync exact stats in try/catch.
- Merge DB + chain creators; chain wins for stats.
- Catch Postgres `23505` per creator and continue; never 500 the whole directory for one duplicate.
- Register route returns 409 for duplicate handle.
- Claim availability checks chain + DB; lookup failure shows an error, not “available”.
Acceptance: recent direct on-chain tip visible after refresh; duplicate handle doesn’t break directory; DB outage still serves chain data; typecheck passes.

## [x] Fix 5 — Ownership, stats, leaderboard
Files: `src/lib/storage.ts`, `src/app/[username]/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/page.tsx`, `src/components/tipping/TopDonorsLeaderboard.tsx`, `src/app/api/creators/[username]/route.ts`, `src/lib/supabaseDb.ts`.
- Add `cacheCreatorProfile` (does not set active handle). Fan page uses it, not `saveStoredCreator`.
- Only set active handle for owned profiles.
- Dashboard summary uses `creator.totalTips` / `creator.totalVolume`, not recent list.
- Add SQL aggregate `getTopDonorsFromDb(creatorId)` and return `leaderboard` from API.
- Leaderboard renders aggregate; fallback to tips only if unavailable.
- Cap localStorage: 100 tips/creator, 50 profiles.
Acceptance: viewing a creator doesn’t change fan’s active handle; dashboard totals match chain; leaderboard is all-time; typecheck passes.

## [x] Fix 6 — Audio storage
Files: `src/app/api/tips/verify/route.ts`, `src/lib/supabaseDb.ts`, `src/app/api/creators/[username]/route.ts`, `src/app/api/overlay/[username]/stream/route.ts`, `src/app/overlay/[username]/page.tsx`, `.env.example`, `README.md`.
- Upload ElevenLabs MP3 to Supabase Storage `stream-alerts/<username>/<signature>.mp3`.
- Store only the URL in `tips.audio_url`; never store base64 data URLs.
- If storage is not configured, store null and log a warning; do not fall back to base64.
- Keep list/SSE payloads free of audio bytes.
Acceptance: new `audio_url` values are URLs or null; API/SSE no longer contain base64 audio; overlay still plays; typecheck passes.

## [x] Fix 7 — Missed-tip recovery
Files: new API route, `src/lib/solanaServer.ts`, `src/lib/supabaseDb.ts`, `src/app/[username]/page.tsx`, `.env.example`, `README.md`.
- Add one authenticated Helius webhook or protected cron route to ingest on-chain tips idempotently.
- Verify the program instruction/event with the Fix 1 verifier.
- Paginate `getSignaturesForAddress` beyond 12 with a configurable cap.
- Client retries failed `/api/tips/verify` calls via localStorage/online events.
- Background ingestion does not generate TTS.
Acceptance: direct on-chain tip appears without the verify call; failed verify retries; no duplicate counters; unauthorized calls rejected; typecheck passes.

## [x] Fix 8 — Security hardening
Files: `src/lib/supabaseDb.ts`, API routes, `next.config.mjs`, optional `src/lib/rateLimit.ts`.
- Remove `ssl: { rejectUnauthorized: false }`.
- Fail closed: DB unavailable => verify returns 503, no TTS/SSE.
- Add rate limits for verify, register, `creators?fresh=1`, `prices?refresh=1`, SSE.
- Return generic errors; log details server-side.
- Add safe security headers; avoid a strict CSP that breaks wallet adapter.
- Document least-privilege DB role.
Acceptance: DB outage returns 503 with no TTS/SSE; 429 after limit; no raw DB errors; headers present; typecheck passes.

## [x] Fix 9 — Next.js upgrade
Files: `package.json`, `package-lock.json`, dynamic routes, ESLint config.
- Upgrade to Next 16.4.6 + React 19 + matching types, or stop and report peer conflicts.
- Make dynamic route `params` async and awaited.
- Update ESLint config/scripts.
- Run `npm audit`, typecheck, build, and smoke-test key routes.
Acceptance: build/typecheck pass; critical Next advisories resolved; wallet/routes still work.

## [x] Fix 10 — Anchor build/tests
Files: `Anchor.toml`, `Cargo.toml`, `programs/solstream/Cargo.toml`, `tests/solstream.ts`, `package.json`, `tsconfig.json`.
- Add standard Anchor workspace scaffolding with the existing program ID.
- Add test deps/scripts; generate `target/types/solstream.ts`.
- Update tests for registry/duplicate handles.
- Add `typecheck`, `test`, and CI scripts.
Acceptance: `anchor build` and `anchor test` pass; `npm run typecheck` passes; README explains setup.

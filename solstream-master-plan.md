# SolStream — Master Execution Plan (DEV3PACK Hackathon Compliant)

**Project Name:** SolStream  
**Workspace:** `c:\Users\HP 840 G8\Desktop\web 3\sol stream`  
**Hackathon Target:** DEV3PACK Hackathon (`app.dev3pack.xyz`)

---

## 🔒 Architectural Security & Invariants

1. **Parse, Don't Trust (Zero-Trust Client):**
   The client sends *only* the transaction `signature` to `/api/tips/verify`. The server fetches the transaction using `connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })`, confirms it succeeded and called our Program ID, and decodes the `TipEvent` using Anchor's `EventParser`. Amount, tier, display name, and message are sourced **exclusively from the on-chain event**.
2. **Internalized TTS (Credit Burn Protection):**
   There is **no public `/api/tts` endpoint**. Text-to-speech audio generation runs strictly as an internal server-side step inside `/api/tips/verify`, executed *only* after on-chain verification and replay protection pass.
3. **Creator Registration & PDA Verification (`/api/creators/register`):**
   To prevent anyone from inserting `@kmoney` into Supabase without owning it, the registration route takes `{ walletAddress }`, fetches the PDA on-chain (`[b"creator", authority]`), verifies the username stored in the on-chain account, and only then creates the Supabase row.
4. **Byte Limits for Multilingual Support (Amharic UTF-8):**
   Ethiopic/Amharic characters are 3 bytes each in UTF-8. The Rust contract enforces byte bounds:
   - Message: `300 bytes` (allowing 100 Amharic characters).
   - Display Name: `96 bytes` (allowing 32 Amharic characters).
   - Username: `32 bytes` (restricted on-chain to ASCII `a-z`, `0-9`, and `_`).
   - Voice ID: `20 bytes` (matching ElevenLabs 20-character IDs).
   - Goal Title: `64 bytes`.
5. **Anti-Spam & Math Safety:**
   - Minimum tip: `1_000_000 lamports` (`0.001 SOL`) to prevent dust attacks burning ElevenLabs credits.
   - In `send_tip`, recipient is strictly locked to `creator_account.authority` via `has_one = authority`.
   - All counters use `checked_add`.
6. **Supabase RLS & Public Storage Bucket:**
   - Public `SELECT` on `creators` and `tips`. Inserts/updates restricted strictly to the service role key.
   - Supabase Storage bucket for TTS audio is set to **public-read** so the OBS browser source overlay can play audio files without auth tokens.
7. **Single Source of Truth for Goals:**
   Goal progress lives on-chain. `/api/tips/verify` refreshes `goal_current_sol` from the on-chain PDA account.

---

## 8-Phase Step-by-Step Roadmap

```
Phase 1: Anchor Smart Contract (Rust) & Tests ───► Deploy via SolPG to Devnet
   │
Phase 2: Next.js Frontend Scaffolding with Anchor & Wallet Adapter
   │
Phase 3: Supabase Schema, Public Audio Bucket, & Realtime Publication
   │
Phase 4: Public Fan Tip Page (/[username]) with Anchor CPI Transfer
   │
Phase 5: Zero-Trust Verification Route (/api/tips/verify) + Internalized TTS
   │
Phase 6: Transparent Live OBS Stream Overlay (/overlay/[username]) + Audio Queue
   │
Phase 7: Streamlined Creator Studio Dashboard (/dashboard) + /api/creators/register
   │
Phase 8: Tests, Public GitHub Repo, Deployment Verification, & 3-Min Pitch Video
```

---

### Phase 1: Custom Anchor Smart Contract (Rust) & Test Suite
*Status: Code written in `programs/solstream/src/lib.rs` and `tests/solstream.ts`.*

- [x] **1.1 Program Implementation (`programs/solstream/src/lib.rs`):**
  - PDA `CreatorAccount` with `InitSpace` byte limits.
  - `initialize_creator`: validates username `[a-z0-9_]`, stores voice_id, goal target & title.
  - `send_tip`: recipient locked via `has_one = authority`, requires `amount >= 0.001 SOL`, executes CPI transfer to creator, increments counters via `checked_add`, emits `TipEvent`.
  - `update_goal`: authority-only, resets progress to 0.
  - `update_voice`: authority-only, updates ElevenLabs voice ID.
- [x] **1.2 Integration Test Suite (`tests/solstream.ts`):**
  - Mocha tests: `initialize_creator`, invalid username rejection, real tip with `TipEvent` verification, wrong recipient rejection, dust tip rejection, oversized message rejection, non-authority update rejection.
- [x] **1.3 Build via Solana Playground (`beta.solpg.io`):**
  - Compiled successfully with Program ID: `BN6Zt6ctB4B5dTs8myMrq6CUp5Lea7jMitG9bp8cGKuA`
- [ ] **1.4 Deploy to Devnet:**
  - Connect playground wallet and deploy.
  - Export the generated **IDL** (`solstream.json`).
- [ ] **Verification Gate 1:** Contract deployed to Devnet, Program ID `BN6Zt6ctB4B5dTs8myMrq6CUp5Lea7jMitG9bp8cGKuA` active on Devnet.

---

### Phase 2: Next.js Frontend & Anchor Client Scaffolding
*Goal: Scaffold the Next.js 14 App Router project inside `sol stream/` connected to our Anchor contract.*

- [ ] **2.1 Scaffolding:** Initialize Next.js 14 (App Router) + TypeScript + Tailwind CSS in `sol stream/`.
- [ ] **2.2 Dependencies:**
  - `@coral-xyz/anchor`, `@solana/web3.js`
  - `@solana/wallet-adapter-base`, `@solana/wallet-adapter-react`, `@solana/wallet-adapter-react-ui`
  - `@solana/wallet-adapter-phantom`, `@solana/wallet-adapter-solflare`
  - `@supabase/supabase-js`, `lucide-react`, `clsx`, `tailwind-merge`
- [ ] **2.3 Anchor Client Provider:**
  - Copy exported `solstream.json` IDL into `src/idl/solstream.json`.
  - Implement `useSolStreamProgram()` hook binding Anchor `Program` with connected wallet and Devnet RPC.
- [ ] **Verification Gate 2:** Project compiles cleanly (`npm run build`).

---

### Phase 3: Supabase Schema, Storage & Realtime Setup
*Goal: Secure database layer with strict Row Level Security and public audio bucket.*

- [ ] **3.1 SQL Migration:**
  - `creators` table: `id`, `username` (UNIQUE), `wallet_address` (UNIQUE), `voice_id`, `goal_title`, `goal_target_sol`, `goal_current_sol`, `created_at`.
  - `tips` table: `id`, `signature` (UNIQUE, replay protection), `creator_id`, `donor_wallet`, `display_name`, `amount_sol`, `tier`, `message`, `audio_url`, `created_at`.
- [ ] **3.2 Storage Bucket:** Create `stream-alerts` bucket with **public-read** enabled for TTS audio streaming.
- [ ] **3.3 RLS Policies:**
  - Public `SELECT` on `creators` and `tips`.
  - Inserts/Updates restricted to service role key.
- [ ] **3.4 Realtime Publication:** Enable `postgres_changes` on `tips`.
- [ ] **Verification Gate 3:** Supabase Realtime WebSocket channel receives and broadcasts test events.

---

### Phase 4: Public Fan Tip Page (`/[username]`)
*Goal: High-conversion, gamified fan tipping interface executing smart contract CPI transfers.*

- [ ] **4.1 Dynamic Route (`src/app/[username]/page.tsx`):** Loads creator profile and derives on-chain PDA.
- [ ] **4.2 Micro-Tier Gift Buttons:**
  - ☕ Coffee (`0.005 SOL` ~ $1)
  - 🌹 Rose (`0.01 SOL` ~ $2)
  - 🔥 Fire (`0.025 SOL` ~ $5)
  - 💎 Diamond (`0.05 SOL` ~ $10)
  - 🚀 Rocket (`0.10 SOL` ~ $20)
  - 👑 Crown (`0.25 SOL` ~ $50)
  - Custom amount input with dynamic "~$X.XX (approx)" label.
- [ ] **4.3 Donor Form:** Optional "Display Name" (max 32 chars) + Message input (max 100 chars with live counter).
- [ ] **4.4 Execute On-Chain Tip:** Calls `program.methods.sendTip(...)` via Anchor client, transferring funds and logging the event.
- [ ] **4.5 Real-Time Leaderboard:** Descending order by total amount, excluding creator's wallet, with direct `https://solscan.io/tx/<sig>?cluster=devnet` links.
- [ ] **Verification Gate 4:** Fan connects Phantom, sends tip, contract executes on Devnet, returns transaction signature.

---

### Phase 5: Zero-Trust Verification Route & Internalized TTS (`/api`)
*Goal: Parse on-chain events, generate ElevenLabs audio safely, and push to Supabase.*

- [ ] **5.1 Server Route (`/api/tips/verify`):**
  - Input: `{ signature: string }` only.
  - Server fetches tx from Solana RPC via `connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })`.
  - Verifies tx succeeded and invoked our Program ID.
  - Decodes `TipEvent` using Anchor `EventParser`.
  - Checks database for signature replay attack.
- [ ] **5.2 Internalized ElevenLabs TTS Step:**
  - Runs inside verify route only after valid signature check.
  - Simple profanity/toxicity safety filter.
  - Generates speech audio and uploads to Supabase Storage (or returns base64).
- [ ] **5.3 PDA Goal Synchronization:**
  - Reads `creator_account.goal_current_lamports` from on-chain PDA and updates Supabase `creators` row.
- [ ] **5.4 Insert Tip:** Service role inserts verified tip $\rightarrow$ Supabase Realtime pushes event to OBS.
- [ ] **Verification Gate 5:** Fake signatures rejected with 400; real signatures extract event data, generate voice, and push to WebSocket.

---

### Phase 6: Transparent Live OBS Stream Overlay (`/overlay/[username]`)
*Goal: Lightweight Browser Source loaded into OBS Studio.*

- [ ] **6.1 Transparent Viewport:** `bg-transparent`, no scrollbars, no chrome.
- [ ] **6.2 Ephemeral Alert Card:**
  - Glassmorphic card pops up in upper-third with spring animation.
  - 3D gift icon + Fan Display Name + message speech bubble.
  - Auto-plays the ElevenLabs TTS audio.
  - Auto-dismisses after **7 seconds** (never blocks stream gameplay).
- [ ] **6.3 Audio FIFO Queue:** Sequential playback so rapid tips queue gracefully without overlapping.
- [ ] **6.4 Live Stream Goal Bar:** Bottom progress bar (e.g. `Mic Upgrade: 1.4 / 3.0 SOL`) that smoothly increments on-screen when a tip lands.
- [ ] **6.5 OBS Setup Guide:** Documentation note: In OBS Browser Source, check *"Control audio via OBS"*.
- [ ] **Verification Gate 6:** Fan tip triggers OBS overlay popup, voice plays, goal bar increments, card fades out after 7s.

---

### Phase 7: Streamlined Creator Studio Dashboard (`/dashboard`)
*Goal: Streamer control panel focused on core workflow.*

- [ ] **7.1 Creator Registration (`/api/creators/register`):** Connect Phantom, call `initializeCreator` on-chain, and server registers row after verifying PDA on-chain.
- [ ] **7.2 1-Click OBS Browser Source Banner:** Copy overlay URL with privacy mask toggle.
- [ ] **7.3 ElevenLabs Voice Studio:** Voice cards with sample audio previews (Adam, Rachel, Antoni, etc.) calling `updateVoice` on-chain.
- [ ] **7.4 Stream Goal Manager:** Update goal title and target SOL amount (calls `updateGoal` on-chain).
- [ ] **7.5 Real-Time Tip Ledger:** Live feed of received tips with direct Solscan Devnet links.
- [ ] **7.6 "Wallet & Off-Ramp to Birr" Guide:** Clear educational panel on holding 100% of funds in Phantom with zero middleman hold, and local P2P cashout steps.
- [ ] **Verification Gate 7:** Changing voice or goal in dashboard immediately reflects on the Tip Page and Overlay.

---

### Phase 8: Submission Prep, README & 3-Min Demo Video
*Goal: Maximum scoring on the DEV3PACK hackathon criteria.*

- [ ] **8.1 GitHub Repository:**
  - Clean directory structure (`programs/`, `src/`, `tests/`).
  - `README.md` prominently highlighting:
    - **Solana Program ID (Devnet)** with direct Solscan link.
    - Architecture diagram & features.
    - Step-by-step local setup instructions.
- [ ] **8.2 3-Minute Demo Video Script:**
  - **0:00 - 0:45 (The Problem):** Ethiopian streamer unable to receive global tips; PayPal/SuperChat unavailable.
  - **0:45 - 2:00 (The Live Demo):** Split-screen OBS Studio + Tip Page. Send 0.01 SOL tip $\rightarrow$ contract executes $\rightarrow$ OBS pops $\rightarrow$ ElevenLabs reads message $\rightarrow$ Goal bar updates $\rightarrow$ Solscan proof.
  - **2:00 - 2:40 (The Tech):** Anchor Rust smart contract, PDAs, on-chain events, Supabase Realtime, ElevenLabs TTS.
  - **2:40 - 3:00 (Conclusion):** True financial sovereignty for creators worldwide.
- [ ] **Verification Gate 8:** Video recorded under 3 minutes, public GitHub repo published, deployment verified.

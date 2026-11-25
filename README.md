# SolStream ⚡

**Non-Custodial Web3 Live-Streaming Monetization on Solana Devnet**  
*Built for the DEV3PACK Solana Hackathon*

---

## 🎯 Problem & Solution

Traditional streaming monetization platforms (Twitch Bits, YouTube SuperChat) take **30%–50% cuts**, delay payouts up to 60 days, and remain completely unavailable across developing regions without PayPal or Stripe access.

**SolStream** turns Solana into a zero-fee, real-time creator tip rail directly connected to **OBS Studio**:
- **0% Platform Cut:** Tips transfer peer-to-peer from donor wallet to creator wallet via Anchor `SystemProgram::transfer` CPI.
- **Instant On-Chain Finality:** Sub-second confirmation with public Solscan proof on every tip.
- **Real-Time OBS Browser Source:** Transparent 1920×1080 overlay pops up with spring animations, a synth chime, AI text-to-speech alert reading, and a live stream goal bar.
- **Multilingual / Amharic UTF-8 Support:** Smart contract enforces byte boundaries (`300 bytes` message limit) so creators and fans can stream in Amharic (`መልካም ስራ! በርታ!`) and English seamlessly.
- **Live Solana Ecosystem Price Feed:** Homepage displays live CoinGecko/Binance prices, 24h changes, 7d sparklines, and live USD micro-tip equivalents.

---

## 🔗 Deployed Solana Smart Contract (Devnet)

- **Program ID:** [`BN6Zt6ctB4B5dTs8myMrq6CUp5Lea7jMitG9bp8cGKuA`](https://solscan.io/account/BN6Zt6ctB4B5dTs8myMrq6CUp5Lea7jMitG9bp8cGKuA?cluster=devnet)
- **Contract Source:** [`programs/solstream/src/lib.rs`](./programs/solstream/src/lib.rs)
- **Anchor 0.30 IDL:** [`src/idl/solstream.json`](./src/idl/solstream.json)

### Instructions
- `initialize_creator(username, voice_id, goal_target, goal_title)` — Allocates creator PDA (`[b"creator", authority]`).
- `send_tip(amount, tier, display_name, message)` — Enforces `amount >= 1_000_000` lamports (`0.001 SOL`), locks recipient with `has_one = authority`, executes CPI transfer, updates counters with `checked_add`, and emits `TipEvent`.
- `update_goal(new_target, new_title)` — Creator-only goal manager.
- `update_voice(new_voice_id)` — Creator-only alert persona updater.

---

## 🗂️ Application Routes

| Route | Purpose |
| :--- | :--- |
| `/` | Homepage, interactive flow preview, handle claim bar, and Live Solana Ecosystem Market Board (`/api/prices`). |
| `/claim` | On-chain handle registration, alert voice picker, and stream goal setup. |
| `/dashboard` | Creator Studio with OBS Browser Source URL, live SOL metrics, goal & voice controls, and realtime tip ledger. |
| `/[username]` | Public fan tipping page with 6 micro-tiers, live SOL/USD converter, Amharic preset chips, and sorted Top Supporters leaderboard. |
| `/overlay/[username]` | Transparent OBS Studio Browser Source overlay with 7s auto-dismiss alert cards, synth chime + ElevenLabs AI voice (with browser speech fallback), FIFO queue, and goal bar. |
| `/api/tips/recover` | Protected background tip-recovery endpoint (`GET`/`POST`, fails closed with `503` if `SOLSTREAM_RECOVERY_SECRET` / `CRON_SECRET` is unset and `401` if unauthorized) that scans paginated on-chain signatures (`SOLSTREAM_SIG_FETCH_CAP`) and ingests missed tips idempotently without generating TTS. |
| `/api/prices` | Server-cached live Solana ecosystem price feed (CoinGecko primary with Binance fallback). |

---

## 🛠️ Tech Stack

- **Blockchain:** Solana Devnet, Anchor `0.30.1` (Rust)
- **Database & Audio Storage:** Supabase PostgreSQL, Realtime, and Storage (`stream-alerts/<username>/<signature>.mp3`)
- **Frontend:** Next.js 16 (App Router), TypeScript, Tailwind CSS
- **Typography:** `Space Grotesk`, `Plus Jakarta Sans`, `JetBrains Mono`
- **Wallets:** `@solana/wallet-adapter-react` (Solana Wallet Standard: Phantom, Solflare, Backpack)
- **Market Data:** CoinGecko Markets API & Binance 24h Ticker API

---

## 🚀 Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables (copy `.env.example` to `.env.local`):
   - Set `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for Supabase persistence and Realtime alerts.
   - Set `ELEVENLABS_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to upload ElevenLabs TTS MP3 files to the public `stream-alerts` Supabase Storage bucket (`stream-alerts/<username>/<signature>.mp3`) and store only the public URL in `tips.audio_url`. When storage is not configured, `tips.audio_url` is stored as `null` and the OBS overlay falls back to browser speech synthesis.

3. Run development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) and connect your Phantom wallet switched to **Solana Devnet**.

---

## 🧪 Typechecking, Linting & Anchor Tests

### Frontend & API Checks
```bash
npm run typecheck
npm run lint
npm run build
```

### Anchor Smart Contract Build & Test Setup
This workspace includes standard Anchor `0.30.1` scaffolding ([`Anchor.toml`](./Anchor.toml), [`Cargo.toml`](./Cargo.toml), [`programs/solstream/Cargo.toml`](./programs/solstream/Cargo.toml), and [`target/types/solstream.ts`](./target/types/solstream.ts)) bound to program ID `BN6Zt6ctB4B5dTs8myMrq6CUp5Lea7jMitG9bp8cGKuA`.

To build the Solana program and run the full Anchor Mocha test suite in [`tests/solstream.ts`](./tests/solstream.ts) (requires Rust, Solana CLI, and Anchor CLI `0.30.1`, e.g. on Linux/macOS/WSL2 or via GitHub Actions CI in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)):
```bash
# Install Anchor 0.30.1 + Solana CLI, then:
anchor build
npm test   # runs `anchor test` against local validator
```

---

## 🔒 Security & Least-Privilege Database Role

- **Verified PostgreSQL TLS:** Server connections enforce certificate validation (`rejectUnauthorized: true`). Hosted Supabase pooler connections require the Supabase root CA via `DATABASE_SSL_CA` (PEM contents) or `PGSSLROOTCERT` (file path). Never commit `.crt` / `.pem` certificate files to Git—configure them via environment variables or secret managers in deployment.
- **Protected Recovery Route:** `/api/tips/recover` fails closed (`503`) when neither `SOLSTREAM_RECOVERY_SECRET` nor `CRON_SECRET` is configured, and rejects missing/invalid credentials with `401`.
- **Least-Privilege DB Role:** Create a dedicated non-superuser role (`solstream_app`) with access limited to `public.creators` and `public.tips` (no `CREATE`, `DROP`, `ALTER`, or `TRUNCATE`):
  ```sql
  CREATE ROLE solstream_app WITH LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD' NOBYPASSRLS;
  GRANT USAGE ON SCHEMA public TO solstream_app;
  GRANT SELECT, INSERT, UPDATE ON TABLE public.creators, public.tips TO solstream_app;
  ```
- **API Rate Limits & Fail-Closed Verify:** `POST /api/tips/verify` fails closed (`503`) if the database is unavailable (without running TTS or SSE), and rate limits protect `/api/tips/verify`, `/api/creators/register`, `?fresh=1`, `?refresh=1`, and SSE endpoints (`429`).

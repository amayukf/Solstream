# HandleRegistry Upgrade & Legacy Creator Migration Runbook

This runbook covers deploying the updated `solstream` Anchor program (`HandleRegistry`) and migrating existing legacy creators created prior to on-chain unique handle enforcement.

> **Important:** Existing Devnet `CreatorAccount` PDAs (`seeds = ["creator", authority]`) remain intact across a program upgrade (`solana program deploy`), provided the `CreatorAccount` struct layout is unchanged (it is unchanged).

## 1. Pre-Upgrade Verification
1. Verify program build & tests locally where Rust, Solana CLI, and Anchor `0.30.1` are installed (not run automatically when the local Anchor toolchain is unavailable):
   ```bash
   anchor build
   anchor test
   ```
2. Verify IDL parity between `target/idl/solstream.json` and `src/idl/solstream.json`:
   - `HandleRegistry` account discriminator: `[120, 46, 76, 126, 63, 168, 217, 232]` (`SHA256("account:HandleRegistry")[0..8]`)
   - `register_existing_handle` instruction discriminator: `[155, 216, 71, 55, 163, 90, 3, 69]` (`SHA256("global:register_existing_handle")[0..8]`)
   - `initialize_creator` accounts order: `creator_account`, `handle_registry`, `authority`, `system_program`

## 2. Program Upgrade (Manual Operator Step)
Upgrade the existing Devnet program (`BN6Zt6ctB4B5dTs8myMrq6CUp5Lea7jMitG9bp8cGKuA`) with the original upgrade authority keypair:
```bash
solana config set --url devnet
anchor upgrade target/deploy/solstream.so --program-id BN6Zt6ctB4B5dTs8myMrq6CUp5Lea7jMitG9bp8cGKuA
```

## 3. Legacy Creator Backfill (`register_existing_handle`)
Legacy creators who initialized their `CreatorAccount` before this upgrade do not yet have a `HandleRegistry` PDA (`seeds = ["handle", username.as_bytes()]`). Until backfilled, another wallet could claim their username in `HandleRegistry`!

1. List all existing on-chain `CreatorAccount` PDAs (`GET /api/creators`).
2. Notify legacy creators (or expose a Studio banner action) to sign `registerExistingHandle(username)` once from their creator `authority` wallet:
   - Accounts required:
     - `creator_account`: PDA `["creator", authority]`
     - `handle_registry`: PDA `["handle", creator_account.username.as_bytes()]`
     - `authority`: Signer (creator wallet, pays ~0.00117 SOL rent for 41-byte `HandleRegistry`)
     - `system_program`: `11111111111111111111111111111111`
3. Handle conflict policy (if two legacy accounts shared the same username pre-upgrade):
   - Only the first creator to execute `register_existing_handle` secures `HandleRegistry` for that handle; subsequent callers will receive `AccountAlreadyInUse` (`0x0`).

## 4. Post-Upgrade Checks
- Visit `/claim`, type an already-claimed handle -> confirm badge shows `Taken` from `fetchHandleRegistry` even if the DB cache is cleared.
- Attempt duplicate `initializeCreator` from a second wallet -> confirm transaction fails on-chain with `0x0` (`already in use`).
- Re-calling `registerExistingHandle` from the same creator wallet -> confirm transaction fails cleanly (`already in use`).

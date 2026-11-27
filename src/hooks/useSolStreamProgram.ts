"use client";

import { useMemo, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/constants";
import { IDL } from "@/idl/solstream";

const DEFAULT_PUBKEY = new PublicKey("11111111111111111111111111111111");
const CREATOR_ACCOUNT_DISC = [222, 163, 32, 169, 204, 8, 200, 32];
const HANDLE_REGISTRY_DISC = [120, 46, 76, 126, 63, 168, 217, 232];

export function decodeHandleRegistry(buffer: Uint8Array | Buffer) {
  try {
    const buf = Buffer.from(buffer);
    if (buf.length < 8 + 32 + 1) return null;
    for (let i = 0; i < 8; i++) {
      if (buf[i] !== HANDLE_REGISTRY_DISC[i]) return null;
    }
    const authority = new PublicKey(buf.slice(8, 40)).toBase58();
    const bump = buf.readUInt8(40);
    return { authority, bump };
  } catch {
    return null;
  }
}

export function decodeCreatorAccount(buffer: Uint8Array | Buffer) {
  try {
    const buf = Buffer.from(buffer);
    if (buf.length < 8 + 32 + 4 + 4 + 4 + 32 + 1) return null;
    for (let i = 0; i < 8; i++) {
      if (buf[i] !== CREATOR_ACCOUNT_DISC[i]) return null;
    }
    let offset = 8; // skip 8-byte discriminator
    const authority = new PublicKey(buf.slice(offset, offset + 32)).toBase58();
    offset += 32;

    if (offset + 4 > buf.length) return null;
    const usernameLen = buf.readUInt32LE(offset);
    offset += 4;
    if (usernameLen > 128 || offset + usernameLen > buf.length) return null;
    const username = buf.slice(offset, offset + usernameLen).toString("utf8");
    offset += usernameLen;

    if (offset + 4 > buf.length) return null;
    const voiceLen = buf.readUInt32LE(offset);
    offset += 4;
    if (voiceLen > 128 || offset + voiceLen > buf.length) return null;
    const voiceId = buf.slice(offset, offset + voiceLen).toString("utf8");
    offset += voiceLen;

    if (offset + 4 > buf.length) return null;
    const titleLen = buf.readUInt32LE(offset);
    offset += 4;
    if (titleLen > 256 || offset + titleLen > buf.length) return null;
    const goalTitle = buf.slice(offset, offset + titleLen).toString("utf8");
    offset += titleLen;

    if (offset + 33 > buf.length) return null;
    const goalTargetLamports = Number(buf.readBigUInt64LE(offset));
    offset += 8;

    const goalCurrentLamports = Number(buf.readBigUInt64LE(offset));
    offset += 8;

    const totalTips = Number(buf.readBigUInt64LE(offset));
    offset += 8;

    const totalVolume = Number(buf.readBigUInt64LE(offset));
    offset += 8;

    const bump = buf.readUInt8(offset);

    return {
      authority,
      username,
      voiceId,
      goalTitle,
      goalTargetLamports,
      goalCurrentLamports,
      totalTips,
      totalVolume,
      bump,
    };
  } catch (e) {
    console.warn("Manual decode failed:", e);
    return null;
  }
}

export function useSolStreamProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const provider = useMemo(() => {
    if (!wallet || !wallet.publicKey) return null;
    return new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
  }, [connection, wallet]);

  const program = useMemo(() => {
    if (typeof window === "undefined") return null;

    const currentProvider =
      provider ||
      new AnchorProvider(
        connection,
        {
          publicKey: DEFAULT_PUBKEY,
          signTransaction: async () => {
            throw new Error("Wallet not connected");
          },
          signAllTransactions: async () => {
            throw new Error("Wallet not connected");
          },
        } as any,
        { commitment: "confirmed" }
      );

    const configuredIdl = {
      ...(IDL as Record<string, unknown>),
      address: PROGRAM_ID.toBase58(),
    };

    return new Program(configuredIdl as any, currentProvider);
  }, [provider, connection]);

  const getCreatorPda = useCallback((authority: PublicKey) => {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator"), authority.toBuffer()],
      PROGRAM_ID
    );
    return pda;
  }, []);

  const getHandlePda = useCallback((username: string) => {
    const clean = username.trim().toLowerCase();
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("handle"), Buffer.from(clean, "utf8")],
      PROGRAM_ID
    );
    return pda;
  }, []);

  const fetchHandleRegistry = useCallback(
    async (username: string) => {
      const clean = username.trim().toLowerCase();
      if (!clean) return null;
      const pda = getHandlePda(clean);
      const info = await connection.getAccountInfo(pda, "confirmed");
      if (!info || !info.data || info.data.length === 0) return null;
      const decoded = decodeHandleRegistry(info.data);
      if (decoded) {
        return { pda: pda.toBase58(), ...decoded };
      }
      if (program) {
        const acc = await (program.account as any).handleRegistry.fetchNullable(pda);
        if (acc?.authority) {
          return {
            pda: pda.toBase58(),
            authority: acc.authority.toBase58 ? acc.authority.toBase58() : String(acc.authority),
            bump: Number(acc.bump) || 0,
          };
        }
      }
      return null;
    },
    [connection, getHandlePda, program]
  );

  const fetchCreatorAccount = useCallback(
    async (pda: PublicKey) => {
      // 1. Try Anchor high-level fetch first
      if (program) {
        try {
          const acc = await (program.account as any).creatorAccount.fetch(pda);
          if (acc) return acc;
        } catch {
          // Fall through to direct RPC fetch
        }
      }

      // 2. Direct on-chain fallback from Solana RPC with manual Borsh decoding
      try {
        const info = await connection.getAccountInfo(pda, "confirmed");
        if (info && info.data && info.data.length > 0) {
          const decoded = decodeCreatorAccount(info.data);
          if (decoded) {
            return {
              ...decoded,
              isRawActive: true,
            };
          }
          if (info.owner.equals(PROGRAM_ID)) {
            return {
              isRawActive: true,
              username: "",
            };
          }
        }
      } catch (e2) {
        console.warn("Direct RPC check error:", e2);
      }
      return null;
    },
    [program, connection]
  );

  const initializeCreator = useCallback(
    async (
      username: string,
      voiceId: string,
      goalTargetLamports: number | bigint,
      goalTitle: string
    ) => {
      if (!wallet.publicKey || !program) throw new Error("Wallet not connected");
      const cleanUsername = username.trim().toLowerCase();
      const creatorPda = getCreatorPda(wallet.publicKey);
      const handlePda = getHandlePda(cleanUsername);
      const methods = (program as any).methods;

      const tx = await methods
        .initializeCreator(
          cleanUsername,
          voiceId,
          new BN(goalTargetLamports.toString()),
          goalTitle
        )
        .accounts({
          creatorAccount: creatorPda,
          handleRegistry: handlePda,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return { tx, pda: creatorPda, handlePda };
    },
    [program, wallet.publicKey, getCreatorPda, getHandlePda]
  );

  const registerExistingHandle = useCallback(
    async (username: string) => {
      if (!wallet.publicKey || !program) throw new Error("Wallet not connected");
      const cleanUsername = username.trim().toLowerCase();
      const creatorPda = getCreatorPda(wallet.publicKey);
      const handlePda = getHandlePda(cleanUsername);
      const methods = (program as any).methods;

      const tx = await methods
        .registerExistingHandle()
        .accounts({
          creatorAccount: creatorPda,
          handleRegistry: handlePda,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return { tx, handlePda };
    },
    [program, wallet.publicKey, getCreatorPda, getHandlePda]
  );

  const sendTip = useCallback(
    async (
      amountLamports: number | bigint,
      tier: number,
      displayName: string,
      message: string,
      creatorAuthority: PublicKey
    ) => {
      if (!wallet.publicKey || !program) throw new Error("Wallet not connected");
      const creatorPda = getCreatorPda(creatorAuthority);
      const methods = (program as any).methods;

      const tx = await methods
        .sendTip(
          new BN(amountLamports.toString()),
          tier,
          displayName,
          message
        )
        .accounts({
          donor: wallet.publicKey,
          creatorAccount: creatorPda,
          authority: creatorAuthority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return { tx, creatorPda };
    },
    [program, wallet.publicKey, getCreatorPda]
  );

  const updateGoal = useCallback(
    async (newTargetLamports: number | bigint, newTitle: string) => {
      if (!wallet.publicKey || !program) throw new Error("Wallet not connected");
      const creatorPda = getCreatorPda(wallet.publicKey);
      const methods = (program as any).methods;

      return await methods
        .updateGoal(new BN(newTargetLamports.toString()), newTitle)
        .accounts({
          creatorAccount: creatorPda,
          authority: wallet.publicKey,
        })
        .rpc();
    },
    [program, wallet.publicKey, getCreatorPda]
  );

  const updateVoice = useCallback(
    async (newVoiceId: string) => {
      if (!wallet.publicKey || !program) throw new Error("Wallet not connected");
      const creatorPda = getCreatorPda(wallet.publicKey);
      const methods = (program as any).methods;

      return await methods
        .updateVoice(newVoiceId)
        .accounts({
          creatorAccount: creatorPda,
          authority: wallet.publicKey,
        })
        .rpc();
    },
    [program, wallet.publicKey, getCreatorPda]
  );

  return {
    program,
    provider,
    getCreatorPda,
    getHandlePda,
    fetchCreatorAccount,
    fetchHandleRegistry,
    initializeCreator,
    registerExistingHandle,
    sendTip,
    updateGoal,
    updateVoice,
  };
}

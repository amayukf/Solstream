"use client";

import { useMemo, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/constants";
import { IDL } from "@/idl/solstream";

const DEFAULT_PUBKEY = new PublicKey("11111111111111111111111111111111");

export function decodeCreatorAccount(buffer: Uint8Array | Buffer) {
  try {
    const buf = Buffer.from(buffer);
    if (buf.length < 8 + 32 + 4) return null;
    let offset = 8; // skip 8-byte discriminator
    const authority = new PublicKey(buf.slice(offset, offset + 32)).toBase58();
    offset += 32;

    const usernameLen = buf.readUInt32LE(offset);
    offset += 4;
    const username = buf.slice(offset, offset + usernameLen).toString("utf8");
    offset += usernameLen;

    const voiceLen = buf.readUInt32LE(offset);
    offset += 4;
    const voiceId = buf.slice(offset, offset + voiceLen).toString("utf8");
    offset += voiceLen;

    const titleLen = buf.readUInt32LE(offset);
    offset += 4;
    const goalTitle = buf.slice(offset, offset + titleLen).toString("utf8");
    offset += titleLen;

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

    return new Program(IDL as any, currentProvider);
  }, [provider, connection]);

  const getCreatorPda = useCallback((authority: PublicKey) => {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator"), authority.toBuffer()],
      PROGRAM_ID
    );
    return pda;
  }, []);

  const fetchCreatorAccount = useCallback(
    async (pda: PublicKey) => {
      // 1. Try Anchor high-level fetch first
      if (program) {
        try {
          const acc = await (program.account as any).creatorAccount.fetch(pda);
          if (acc) return acc;
        } catch (err) {
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
      const creatorPda = getCreatorPda(wallet.publicKey);
      const methods = (program as any).methods;

      const tx = await methods
        .initializeCreator(
          username,
          voiceId,
          new BN(goalTargetLamports.toString()),
          goalTitle
        )
        .accounts({
          creatorAccount: creatorPda,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return { tx, pda: creatorPda };
    },
    [program, wallet.publicKey, getCreatorPda]
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
    fetchCreatorAccount,
    initializeCreator,
    sendTip,
    updateGoal,
    updateVoice,
  };
}

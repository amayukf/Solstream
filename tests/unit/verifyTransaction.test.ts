import "./setup";
import { expect } from "chai";
import bs58 from "bs58";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { PROGRAM_ID } from "../../src/lib/constants";
import {
  SEND_TIP_DISC,
  verifySolstreamTipTransaction,
} from "../../src/lib/solanaServer";

const TIP_EVENT_DISC = [213, 36, 191, 50, 28, 25, 189, 252];

function encodeString(value: string): Buffer {
  const utf8 = Buffer.from(value, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(utf8.length, 0);
  return Buffer.concat([len, utf8]);
}

function buildSendTipIxData(params: {
  amountLamports: number;
  tier: number;
  displayName: string;
  message: string;
}): string {
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(BigInt(params.amountLamports), 0);
  const raw = Buffer.concat([
    Buffer.from(SEND_TIP_DISC),
    amountBuf,
    Buffer.from([params.tier]),
    encodeString(params.displayName),
    encodeString(params.message),
  ]);
  return bs58.encode(raw);
}

function buildTipEventLog(params: {
  creator: PublicKey;
  donor: PublicKey;
  amountLamports: number;
  tier: number;
  displayName: string;
  message: string;
  timestampSec: number;
}): string {
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(BigInt(params.amountLamports), 0);
  const tsBuf = Buffer.alloc(8);
  tsBuf.writeBigInt64LE(BigInt(params.timestampSec), 0);

  const buf = Buffer.concat([
    Buffer.from(TIP_EVENT_DISC),
    Buffer.from(params.creator.toBytes()),
    Buffer.from(params.donor.toBytes()),
    amountBuf,
    Buffer.from([params.tier]),
    encodeString(params.displayName),
    encodeString(params.message),
    tsBuf,
  ]);
  return `Program data: ${buf.toString("base64")}`;
}

function deriveCreatorPda(authority: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator"), authority.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

describe("verifySolstreamTipTransaction", () => {
  it("accepts a valid Solstream send_tip tx with a trailing Solana Pay reference key", () => {
    const donor = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;
    const creatorPda = deriveCreatorPda(authority);
    const refKey = Keypair.generate().publicKey;
    const amountLamports = 5_000_000;

    const tx = {
      blockTime: 1_750_000_000,
      meta: {
        err: null,
        logMessages: [
          `Program ${PROGRAM_ID.toBase58()} invoke [1]`,
          "Program log: Instruction: SendTip",
          buildTipEventLog({
            creator: authority,
            donor,
            amountLamports,
            tier: 0,
            displayName: "Abebe",
            message: "GG stream!",
            timestampSec: 1_750_000_000,
          }),
          `Program ${PROGRAM_ID.toBase58()} success`,
        ],
      },
      transaction: {
        message: {
          header: { numRequiredSignatures: 1 },
          accountKeys: [
            donor.toBase58(),
            creatorPda.toBase58(),
            authority.toBase58(),
            SystemProgram.programId.toBase58(),
            refKey.toBase58(),
            PROGRAM_ID.toBase58(),
          ],
          instructions: [
            {
              programIdIndex: 5,
              accounts: [0, 1, 2, 3, 4],
              data: buildSendTipIxData({
                amountLamports,
                tier: 0,
                displayName: "Abebe",
                message: "GG stream!",
              }),
            },
          ],
        },
      },
    };

    const parsed = verifySolstreamTipTransaction(
      tx,
      "5ValidSig111111111111111111111111111111111",
      authority.toBase58()
    );

    expect(parsed).to.not.equal(null);
    expect(parsed?.creator).to.equal(authority.toBase58());
    expect(parsed?.donor).to.equal(donor.toBase58());
    expect(parsed?.amountLamports).to.equal(amountLamports);
    expect(parsed?.displayName).to.equal("Abebe");
    expect(parsed?.message).to.equal("GG stream!");
  });

  it("rejects when expectedCreatorAuthority does not match the tx recipient", () => {
    const donor = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;
    const wrongCreator = Keypair.generate().publicKey;
    const creatorPda = deriveCreatorPda(authority);

    const tx = {
      blockTime: 1_750_000_000,
      meta: {
        err: null,
        logMessages: [
          `Program ${PROGRAM_ID.toBase58()} invoke [1]`,
          buildTipEventLog({
            creator: authority,
            donor,
            amountLamports: 10_000_000,
            tier: 1,
            displayName: "Fan",
            message: "Yo",
            timestampSec: 1_750_000_000,
          }),
          `Program ${PROGRAM_ID.toBase58()} success`,
        ],
      },
      transaction: {
        message: {
          header: { numRequiredSignatures: 1 },
          accountKeys: [
            donor.toBase58(),
            creatorPda.toBase58(),
            authority.toBase58(),
            SystemProgram.programId.toBase58(),
            PROGRAM_ID.toBase58(),
          ],
          instructions: [
            {
              programIdIndex: 4,
              accounts: [0, 1, 2, 3],
              data: buildSendTipIxData({
                amountLamports: 10_000_000,
                tier: 1,
                displayName: "Fan",
                message: "Yo",
              }),
            },
          ],
        },
      },
    };

    const parsed = verifySolstreamTipTransaction(
      tx,
      "5WrongRecipientSig",
      wrongCreator.toBase58()
    );
    expect(parsed).to.equal(null);
  });

  it("rejects spoofed TipEvent logs emitted by a non-Solstream program frame", () => {
    const donor = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;
    const creatorPda = deriveCreatorPda(authority);
    const foreignProgram = Keypair.generate().publicKey;

    const tx = {
      blockTime: 1_750_000_000,
      meta: {
        err: null,
        logMessages: [
          `Program ${foreignProgram.toBase58()} invoke [1]`,
          buildTipEventLog({
            creator: authority,
            donor,
            amountLamports: 25_000_000,
            tier: 2,
            displayName: "Spoofer",
            message: "Fake event",
            timestampSec: 1_750_000_000,
          }),
          `Program ${foreignProgram.toBase58()} success`,
        ],
      },
      transaction: {
        message: {
          header: { numRequiredSignatures: 1 },
          accountKeys: [
            donor.toBase58(),
            creatorPda.toBase58(),
            authority.toBase58(),
            SystemProgram.programId.toBase58(),
            PROGRAM_ID.toBase58(),
          ],
          instructions: [
            {
              programIdIndex: 4,
              accounts: [0, 1, 2, 3],
              data: buildSendTipIxData({
                amountLamports: 25_000_000,
                tier: 2,
                displayName: "Spoofer",
                message: "Fake event",
              }),
            },
          ],
        },
      },
    };

    const parsed = verifySolstreamTipTransaction(
      tx,
      "5SpoofedLogSig",
      authority.toBase58()
    );
    expect(parsed).to.equal(null);
  });

  it("rejects failed transactions (meta.err !== null) and dust amounts below MIN_TIP_LAMPORTS", () => {
    const donor = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;
    const creatorPda = deriveCreatorPda(authority);

    const failedTx = {
      meta: { err: { InstructionError: [0, "Custom"] }, logMessages: [] },
      transaction: { message: { accountKeys: [], instructions: [] } },
    };
    expect(verifySolstreamTipTransaction(failedTx, "5FailedSig")).to.equal(null);

    const dustAmount = 500_000; // < 1_000_000
    const dustTx = {
      blockTime: 1_750_000_000,
      meta: {
        err: null,
        logMessages: [
          `Program ${PROGRAM_ID.toBase58()} invoke [1]`,
          buildTipEventLog({
            creator: authority,
            donor,
            amountLamports: dustAmount,
            tier: 0,
            displayName: "Dust",
            message: "Too small",
            timestampSec: 1_750_000_000,
          }),
          `Program ${PROGRAM_ID.toBase58()} success`,
        ],
      },
      transaction: {
        message: {
          header: { numRequiredSignatures: 1 },
          accountKeys: [
            donor.toBase58(),
            creatorPda.toBase58(),
            authority.toBase58(),
            SystemProgram.programId.toBase58(),
            PROGRAM_ID.toBase58(),
          ],
          instructions: [
            {
              programIdIndex: 4,
              accounts: [0, 1, 2, 3],
              data: buildSendTipIxData({
                amountLamports: dustAmount,
                tier: 0,
                displayName: "Dust",
                message: "Too small",
              }),
            },
          ],
        },
      },
    };
    expect(
      verifySolstreamTipTransaction(dustTx, "5DustSig", authority.toBase58())
    ).to.equal(null);
  });
});

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { Solstream } from "../target/types/solstream";

describe("solstream", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Solstream as Program<Solstream>;

  const creator = Keypair.generate();
  const donor = Keypair.generate();
  const stranger = Keypair.generate();

  const [creatorPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator"), creator.publicKey.toBuffer()],
    program.programId
  );

  const airdrop = async (kp: Keypair, sol: number) => {
    const sig = await provider.connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");
  };

  const expectFail = async (fn: () => Promise<unknown>, fragment: string) => {
    try {
      await fn();
    } catch (e: any) {
      assert.include(String(e), fragment);
      return;
    }
    assert.fail(`expected failure containing "${fragment}"`);
  };

  const tip = (
    amountSol: number,
    tier: number,
    name: string,
    msg: string,
    recipient: PublicKey = creator.publicKey
  ) =>
    program.methods
      .sendTip(new BN(amountSol * LAMPORTS_PER_SOL), tier, name, msg)
      .accounts({
        donor: donor.publicKey,
        creatorAccount: creatorPda,
        authority: recipient,
        systemProgram: SystemProgram.programId,
      })
      .signers([donor])
      .rpc();

  before(async () => {
    await airdrop(creator, 1);
    await airdrop(donor, 2);
    await airdrop(stranger, 1);
  });

  it("initializes a creator", async () => {
    await program.methods
      .initializeCreator("kmoney", "pNInz6obpgDQGcFmaJgB", new BN(3 * LAMPORTS_PER_SOL), "Mic Upgrade")
      .accounts({
        creatorAccount: creatorPda,
        authority: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const acc = await program.account.creatorAccount.fetch(creatorPda);
    assert.equal(acc.username, "kmoney");
    assert.equal(acc.goalCurrentLamports.toNumber(), 0);
  });

  it("rejects invalid usernames", async () => {
    const other = Keypair.generate();
    await airdrop(other, 1);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator"), other.publicKey.toBuffer()],
      program.programId
    );
    await expectFail(
      () =>
        program.methods
          .initializeCreator("Bad Name!", "v", new BN(1), "t")
          .accounts({ creatorAccount: pda, authority: other.publicKey, systemProgram: SystemProgram.programId })
          .signers([other])
          .rpc(),
      "InvalidUsername"
    );
  });

  it("sends a tip, moves SOL to the creator and emits TipEvent", async () => {
    const before = await provider.connection.getBalance(creator.publicKey);

    const eventPromise = new Promise<any>((resolve) => {
      const id = program.addEventListener("tipEvent", (ev) => {
        program.removeEventListener(id);
        resolve(ev);
      });
    });

    await tip(0.05, 3, "Abebe_DC", "Keep inspiring Addis!");
    const ev = await eventPromise;

    const after = await provider.connection.getBalance(creator.publicKey);
    assert.equal(after - before, 0.05 * LAMPORTS_PER_SOL);
    assert.equal(ev.displayName, "Abebe_DC");
    assert.equal(ev.tier, 3);
    assert.equal(ev.amount.toNumber(), 0.05 * LAMPORTS_PER_SOL);

    const acc = await program.account.creatorAccount.fetch(creatorPda);
    assert.equal(acc.goalCurrentLamports.toNumber(), 0.05 * LAMPORTS_PER_SOL);
    assert.equal(acc.totalTips.toNumber(), 1);
  });

  it("rejects a tip routed to the wrong recipient", async () => {
    await expectFail(() => tip(0.01, 1, "x", "hi", stranger.publicKey), "WrongRecipient");
  });

  it("rejects dust tips, bad tiers and oversized messages", async () => {
    await expectFail(() => tip(0.0001, 0, "x", "hi"), "TipTooSmall");
    await expectFail(() => tip(0.01, 9, "x", "hi"), "InvalidTier");
    await expectFail(() => tip(0.01, 1, "x", "a".repeat(301)), "MessageTooLong");
  });

  it("only the authority can update the goal", async () => {
    await expectFail(
      () =>
        program.methods
          .updateGoal(new BN(5 * LAMPORTS_PER_SOL), "Hacked")
          .accounts({ creatorAccount: creatorPda, authority: stranger.publicKey })
          .signers([stranger])
          .rpc(),
      "Error"
    );

    await program.methods
      .updateGoal(new BN(5 * LAMPORTS_PER_SOL), "New Camera")
      .accounts({ creatorAccount: creatorPda, authority: creator.publicKey })
      .signers([creator])
      .rpc();

    const acc = await program.account.creatorAccount.fetch(creatorPda);
    assert.equal(acc.goalTitle, "New Camera");
    assert.equal(acc.goalCurrentLamports.toNumber(), 0);
  });
});

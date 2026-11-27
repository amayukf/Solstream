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

  const getHandlePda = (username: string) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("handle"), Buffer.from(username, "utf8")],
      program.programId
    )[0];

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
      .accountsPartial({
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

  it("initializes a creator and reserves the handle in HandleRegistry", async () => {
    const handle = "kmoney";
    const handlePda = getHandlePda(handle);

    await program.methods
      .initializeCreator(handle, "pNInz6obpgDQGcFmaJgB", new BN(3 * LAMPORTS_PER_SOL), "Mic Upgrade")
      .accountsPartial({
        creatorAccount: creatorPda,
        handleRegistry: handlePda,
        authority: creator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    const acc = await program.account.creatorAccount.fetch(creatorPda);
    assert.equal(acc.username, handle);
    assert.equal(acc.goalCurrentLamports.toNumber(), 0);

    const reg = await program.account.handleRegistry.fetch(handlePda);
    assert.equal(reg.authority.toBase58(), creator.publicKey.toBase58());
  });

  it("rejects duplicate handles claimed by a second wallet", async () => {
    const secondWallet = Keypair.generate();
    await airdrop(secondWallet, 1);
    const [secondCreatorPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator"), secondWallet.publicKey.toBuffer()],
      program.programId
    );
    const duplicateHandlePda = getHandlePda("kmoney");

    await expectFail(
      () =>
        program.methods
          .initializeCreator("kmoney", "pNInz6obpgDQGcFmaJgB", new BN(1 * LAMPORTS_PER_SOL), "Copycat")
          .accountsPartial({
            creatorAccount: secondCreatorPda,
            handleRegistry: duplicateHandlePda,
            authority: secondWallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([secondWallet])
          .rpc(),
      "already in use"
    );
  });

  it("rejects invalid usernames", async () => {
    const other = Keypair.generate();
    await airdrop(other, 1);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator"), other.publicKey.toBuffer()],
      program.programId
    );
    const badHandlePda = getHandlePda("Bad Name!");
    await expectFail(
      () =>
        program.methods
          .initializeCreator("Bad Name!", "v", new BN(1), "t")
          .accountsPartial({
            creatorAccount: pda,
            handleRegistry: badHandlePda,
            authority: other.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([other])
          .rpc(),
      "InvalidUsername"
    );
  });

  it("enforces authority and one-time initialization on register_existing_handle", async () => {
    const handlePda = getHandlePda("kmoney");

    // Stranger cannot register someone else's CreatorAccount handle
    await expectFail(
      () =>
        program.methods
          .registerExistingHandle()
          .accountsPartial({
            creatorAccount: creatorPda,
            handleRegistry: handlePda,
            authority: stranger.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([stranger])
          .rpc(),
      "Error"
    );

    // Once HandleRegistry exists for @kmoney, registering again fails cleanly
    await expectFail(
      () =>
        program.methods
          .registerExistingHandle()
          .accountsPartial({
            creatorAccount: creatorPda,
            handleRegistry: handlePda,
            authority: creator.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc(),
      "already in use"
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

  it("only the authority can update the alert voice", async () => {
    await expectFail(
      () =>
        program.methods
          .updateVoice("21m00Tcm4TlvDq8ikWAM")
          .accounts({ creatorAccount: creatorPda, authority: stranger.publicKey })
          .signers([stranger])
          .rpc(),
      "Error"
    );

    await program.methods
      .updateVoice("ErXwobaYiN019PkySvjV")
      .accounts({ creatorAccount: creatorPda, authority: creator.publicKey })
      .signers([creator])
      .rpc();

    const acc = await program.account.creatorAccount.fetch(creatorPda);
    assert.equal(acc.voiceId, "ErXwobaYiN019PkySvjV");
  });
});

import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ShieldedVault, BatchWithdrawer } from "../typechain-types";

// Same real fixture ShieldedVault.test.ts uses — see its own comment for
// provenance. Only one withdraw fixture exists (one fixed nullifier), which
// is enough to test both paths here: a successful batched withdrawal, and a
// failing item (replaying that same nullifier) not blocking the rest of the
// batch.
const NOIR_DIR = path.join(__dirname, "../circuits/noir");
function loadFixture(circuit: "withdraw", pubCount: number) {
  const fixtures = path.join(NOIR_DIR, circuit, "fixtures");
  const proof = "0x" + fs.readFileSync(path.join(fixtures, "proof")).toString("hex");
  const raw = fs.readFileSync(path.join(fixtures, "public_inputs"));
  if (raw.length !== pubCount * 32) throw new Error(`${circuit}: expected ${pubCount * 32} bytes of public inputs`);
  const publicInputs: string[] = [];
  for (let i = 0; i < pubCount; i++) publicInputs.push("0x" + raw.subarray(i * 32, (i + 1) * 32).toString("hex"));
  return { proof, publicInputs };
}

const WITHDRAW_COMMITMENT = "0x1558e1fa811a3e586c2ca3b6d3fe47681eaf479bc5bb69a83fb4505018672fad";
const WITHDRAW_RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const WITHDRAW_AMOUNT = 1000n;
const WITHDRAW_ASSET_ID = 0n;

async function deployHasher() {
  const Poseidon2 = await ethers.getContractFactory("Poseidon2_BN254");
  const hasher = await Poseidon2.deploy();
  await hasher.waitForDeployment();
  return hasher;
}

async function deployHonkVerifier(contractName: string, relationsName: string, transcriptName: string) {
  const Relations = await ethers.getContractFactory(relationsName);
  const relations = await Relations.deploy();
  await relations.waitForDeployment();
  const Transcript = await ethers.getContractFactory(transcriptName);
  const transcript = await Transcript.deploy();
  await transcript.waitForDeployment();
  const Verifier = await ethers.getContractFactory(contractName, {
    libraries: { [relationsName]: await relations.getAddress(), [transcriptName]: await transcript.getAddress() },
  });
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  return verifier;
}

describe("BatchWithdrawer (real Noir/UltraHonk circuit)", function () {
  this.timeout(60_000);

  let vault: ShieldedVault;
  let batcher: BatchWithdrawer;
  let admin: HardhatEthersSigner;
  let alice: HardhatEthersSigner;

  beforeEach(async () => {
    [admin, alice] = await ethers.getSigners();

    const hasher = await deployHasher();
    const withdrawVerifier = await deployHonkVerifier("WithdrawHonkVerifier", "WithdrawRelationsLib", "WithdrawZKTranscriptLib");
    const payVerifier = await deployHonkVerifier("PayHonkVerifier", "PayRelationsLib", "PayZKTranscriptLib");
    const placeOrderVerifier = await deployHonkVerifier("PlaceOrderHonkVerifier", "PlaceOrderRelationsLib", "PlaceOrderZKTranscriptLib");
    const cancelOrderVerifier = await deployHonkVerifier("CancelOrderHonkVerifier", "CancelOrderRelationsLib", "CancelOrderZKTranscriptLib");
    const matchOrdersVerifier = await deployHonkVerifier("MatchOrdersHonkVerifier", "MatchOrdersRelationsLib", "MatchOrdersZKTranscriptLib");

    const Vault = await ethers.getContractFactory("ShieldedVault");
    vault = await Vault.deploy(
      await hasher.getAddress(),
      await withdrawVerifier.getAddress(),
      await payVerifier.getAddress(),
      await placeOrderVerifier.getAddress(),
      await cancelOrderVerifier.getAddress(),
      await matchOrdersVerifier.getAddress(),
      admin.address,
      WITHDRAW_ASSET_ID
    );
    await vault.connect(admin).setAsset(WITHDRAW_ASSET_ID, ethers.ZeroAddress, true);

    const Batcher = await ethers.getContractFactory("BatchWithdrawer");
    batcher = await Batcher.deploy();
  });

  it("submits a real withdraw via the batcher with one signature", async () => {
    await vault.connect(alice).shield(WITHDRAW_ASSET_ID, WITHDRAW_AMOUNT, WITHDRAW_COMMITMENT, { value: WITHDRAW_AMOUNT });
    const { proof, publicInputs } = loadFixture("withdraw", 5);

    const before = await ethers.provider.getBalance(WITHDRAW_RECIPIENT);

    await expect(
      batcher.batchWithdraw(await vault.getAddress(), [
        {
          proof,
          root: publicInputs[0],
          nullifierHash: publicInputs[1],
          amount: WITHDRAW_AMOUNT,
          assetId: WITHDRAW_ASSET_ID,
          recipient: WITHDRAW_RECIPIENT,
        },
      ])
    )
      .to.emit(batcher, "WithdrawAttempted")
      .withArgs(await vault.getAddress(), 0n, publicInputs[1], true);

    expect(await ethers.provider.getBalance(WITHDRAW_RECIPIENT)).to.equal(before + WITHDRAW_AMOUNT);
    expect(await vault.isSpentNullifier(publicInputs[1])).to.equal(true);
  });

  it("doesn't let one failing item block the rest of the batch", async () => {
    await vault.connect(alice).shield(WITHDRAW_ASSET_ID, WITHDRAW_AMOUNT, WITHDRAW_COMMITMENT, { value: WITHDRAW_AMOUNT });
    const { proof, publicInputs } = loadFixture("withdraw", 5);
    const call = {
      proof,
      root: publicInputs[0],
      nullifierHash: publicInputs[1],
      amount: WITHDRAW_AMOUNT,
      assetId: WITHDRAW_ASSET_ID,
      recipient: WITHDRAW_RECIPIENT,
    };

    const before = await ethers.provider.getBalance(WITHDRAW_RECIPIENT);

    // Same real proof submitted twice in one batch: item 0 spends the
    // nullifier for real, item 1 replays it and must fail on-chain
    // (NullifierAlreadySpent) — without reverting item 0's already-confirmed
    // withdrawal or the transaction as a whole.
    const tx = await batcher.batchWithdraw(await vault.getAddress(), [call, call]);
    const receipt = await tx.wait();
    const events = receipt!.logs
      .map((log) => {
        try {
          return batcher.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null && e.name === "WithdrawAttempted");

    expect(events).to.have.length(2);
    expect(events[0].args.success).to.equal(true);
    expect(events[1].args.success).to.equal(false);

    // The real transfer from item 0 still happened, exactly once.
    expect(await ethers.provider.getBalance(WITHDRAW_RECIPIENT)).to.equal(before + WITHDRAW_AMOUNT);
  });

  it("holds no funds — a native withdrawal pays the recipient directly", async () => {
    await vault.connect(alice).shield(WITHDRAW_ASSET_ID, WITHDRAW_AMOUNT, WITHDRAW_COMMITMENT, { value: WITHDRAW_AMOUNT });
    const { proof, publicInputs } = loadFixture("withdraw", 5);

    await batcher.batchWithdraw(await vault.getAddress(), [
      {
        proof,
        root: publicInputs[0],
        nullifierHash: publicInputs[1],
        amount: WITHDRAW_AMOUNT,
        assetId: WITHDRAW_ASSET_ID,
        recipient: WITHDRAW_RECIPIENT,
      },
    ]);

    expect(await ethers.provider.getBalance(await batcher.getAddress())).to.equal(0n);
  });
});

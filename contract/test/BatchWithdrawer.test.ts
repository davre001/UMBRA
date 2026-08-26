import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ShieldedVault, BatchWithdrawer, MockERC20 } from "../typechain-types";

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
  let token: MockERC20;
  let admin: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  beforeEach(async () => {
    [admin, alice, bob] = await ethers.getSigners();

    const hasher = await deployHasher();
    const withdrawVerifier = await deployHonkVerifier("WithdrawHonkVerifier", "WithdrawRelationsLib", "WithdrawZKTranscriptLib");
    const payVerifier = await deployHonkVerifier("PayHonkVerifier", "PayRelationsLib", "PayZKTranscriptLib");
    const placeOrderVerifier = await deployHonkVerifier("PlaceOrderHonkVerifier", "PlaceOrderRelationsLib", "PlaceOrderZKTranscriptLib");
    const cancelOrderVerifier = await deployHonkVerifier("CancelOrderHonkVerifier", "CancelOrderRelationsLib", "CancelOrderZKTranscriptLib");
    const matchOrdersVerifier = await deployHonkVerifier("MatchOrdersHonkVerifier", "MatchOrdersRelationsLib", "MatchOrdersZKTranscriptLib");
    const checkpointRelayVerifier = await deployHonkVerifier("CheckpointRelayHonkVerifier", "CheckpointRelayRelationsLib", "CheckpointRelayZKTranscriptLib");

    const Vault = await ethers.getContractFactory("ShieldedVault");
    vault = await Vault.deploy(
      await hasher.getAddress(),
      await withdrawVerifier.getAddress(),
      await payVerifier.getAddress(),
      await placeOrderVerifier.getAddress(),
      await cancelOrderVerifier.getAddress(),
      await matchOrdersVerifier.getAddress(),
      await checkpointRelayVerifier.getAddress(),
      admin.address,
      WITHDRAW_ASSET_ID
    );
    await vault.connect(admin).setAsset(WITHDRAW_ASSET_ID, ethers.ZeroAddress, true);

    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy("Test USD", "USD0");
    await vault.connect(admin).setAsset(1n, await token.getAddress(), true);

    const Batcher = await ethers.getContractFactory("BatchWithdrawer");
    batcher = await Batcher.deploy();
  });

  describe("Single and Multiple Batch Withdrawals", () => {
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

    it("handles an empty batch call gracefully with zero events and zero state changes", async () => {
      const tx = await batcher.batchWithdraw(await vault.getAddress(), []);
      const receipt = await tx.wait();
      expect(receipt!.logs).to.have.length(0);
    });
  });

  describe("Partial Success & Fault Tolerance", () => {
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
      expect(events[0].args.index).to.equal(0n);
      expect(events[0].args.success).to.equal(true);
      expect(events[1].args.index).to.equal(1n);
      expect(events[1].args.success).to.equal(false);

      // The real transfer from item 0 still happened, exactly once.
      expect(await ethers.provider.getBalance(WITHDRAW_RECIPIENT)).to.equal(before + WITHDRAW_AMOUNT);
    });

    it("gracefully catches a call to an invalid/reverting target without reverting batch", async () => {
      const { proof, publicInputs } = loadFixture("withdraw", 5);
      const invalidCall = {
        proof,
        root: publicInputs[0],
        nullifierHash: publicInputs[1],
        amount: WITHDRAW_AMOUNT,
        assetId: WITHDRAW_ASSET_ID,
        recipient: WITHDRAW_RECIPIENT,
      };

      // Target a deployed contract that does not implement withdraw (e.g. MockERC20)
      const nonVaultContract = await token.getAddress();
      const tx = await batcher.batchWithdraw(nonVaultContract, [invalidCall]);
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

      expect(events).to.have.length(1);
      expect(events[0].args.vault).to.equal(nonVaultContract);
      expect(events[0].args.success).to.equal(false);
    });

    it("handles batch with tampered roots and invalid amounts emitting success: false", async () => {
      await vault.connect(alice).shield(WITHDRAW_ASSET_ID, WITHDRAW_AMOUNT, WITHDRAW_COMMITMENT, { value: WITHDRAW_AMOUNT });
      const { proof, publicInputs } = loadFixture("withdraw", 5);

      const tamperedRootCall = {
        proof,
        root: "0x1111111111111111111111111111111111111111111111111111111111111111",
        nullifierHash: publicInputs[1],
        amount: WITHDRAW_AMOUNT,
        assetId: WITHDRAW_ASSET_ID,
        recipient: WITHDRAW_RECIPIENT,
      };

      const tamperedAmountCall = {
        proof,
        root: publicInputs[0],
        nullifierHash: publicInputs[1],
        amount: 999999n,
        assetId: WITHDRAW_ASSET_ID,
        recipient: WITHDRAW_RECIPIENT,
      };

      const tx = await batcher.batchWithdraw(await vault.getAddress(), [tamperedRootCall, tamperedAmountCall]);
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
      expect(events[0].args.success).to.equal(false);
      expect(events[1].args.success).to.equal(false);
      expect(await vault.isSpentNullifier(publicInputs[1])).to.equal(false);
    });
  });

  describe("Invariants & Balance Safety", () => {
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

    it("allows any arbitrary third party relayer to execute the batch for the recipient", async () => {
      await vault.connect(alice).shield(WITHDRAW_ASSET_ID, WITHDRAW_AMOUNT, WITHDRAW_COMMITMENT, { value: WITHDRAW_AMOUNT });
      const { proof, publicInputs } = loadFixture("withdraw", 5);

      const before = await ethers.provider.getBalance(WITHDRAW_RECIPIENT);

      // Bob (relayer) executes the batch
      await batcher.connect(bob).batchWithdraw(await vault.getAddress(), [
        {
          proof,
          root: publicInputs[0],
          nullifierHash: publicInputs[1],
          amount: WITHDRAW_AMOUNT,
          assetId: WITHDRAW_ASSET_ID,
          recipient: WITHDRAW_RECIPIENT,
        },
      ]);

      expect(await ethers.provider.getBalance(WITHDRAW_RECIPIENT)).to.equal(before + WITHDRAW_AMOUNT);
      expect(await ethers.provider.getBalance(await batcher.getAddress())).to.equal(0n);
    });
  });
});

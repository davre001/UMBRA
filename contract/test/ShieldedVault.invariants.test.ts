import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ShieldedVault, ComplianceRegistry, MockERC20 } from "../typechain-types";

const NOIR_DIR = path.join(__dirname, "../circuits/noir");
function loadFixture(
  circuit: "withdraw" | "pay" | "place_order" | "cancel_order" | "match_orders" | "btc_deposit",
  pubCount: number
) {
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
const NATIVE_ASSET_ID = 0n;
const ERC20_ASSET_ID = 1n;

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

describe("ShieldedVault Invariants & Fuzzing", function () {
  this.timeout(300_000);

  let vault: ShieldedVault;
  let compliance: ComplianceRegistry;
  let token: MockERC20;
  let admin: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charlie: HardhatEthersSigner;

  beforeEach(async () => {
    [admin, alice, bob, charlie] = await ethers.getSigners();

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
      NATIVE_ASSET_ID
    );

    // Deploy and register compliance
    const Compliance = await ethers.getContractFactory("ComplianceRegistry");
    compliance = await Compliance.deploy(admin.address);
    await compliance.connect(admin).grantRole(await compliance.ATTESTER_ROLE(), admin.address);
    await vault.connect(admin).setComplianceRegistry(await compliance.getAddress());

    // Register native asset (0) and ERC20 asset (1)
    await vault.connect(admin).setAsset(NATIVE_ASSET_ID, ethers.ZeroAddress, true);

    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy("USD Tether", "USDT0");
    await vault.connect(admin).setAsset(ERC20_ASSET_ID, await token.getAddress(), true);

    // Pre-mint tokens
    await token.mint(alice.address, ethers.parseEther("1000000"));
    await token.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await token.mint(bob.address, ethers.parseEther("1000000"));
    await token.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  describe("Invariant 1: Vault Solvency & Balance Conservation", () => {
    it("conserves native balances across multiple randomized deposits and authorized withdrawals", async () => {
      let expectedBalance = 0n;
      const initialVaultBalance = await ethers.provider.getBalance(await vault.getAddress());
      expect(initialVaultBalance).to.equal(0n);

      // 1. Screen recipient
      await compliance.connect(admin).screen(WITHDRAW_RECIPIENT, true);

      // 2. Legitimate single-leaf deposit and authorized withdrawal
      const { proof, publicInputs } = loadFixture("withdraw", 5);
      await vault.connect(alice).shield(NATIVE_ASSET_ID, WITHDRAW_AMOUNT, WITHDRAW_COMMITMENT, { value: WITHDRAW_AMOUNT });
      expectedBalance += WITHDRAW_AMOUNT;
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(expectedBalance);

      await vault.withdraw(proof, publicInputs[0], publicInputs[1], WITHDRAW_AMOUNT, NATIVE_ASSET_ID, WITHDRAW_RECIPIENT);
      expectedBalance -= WITHDRAW_AMOUNT;
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(expectedBalance);

      // 3. Fuzz: 5 pseudo-random subsequent native deposits
      const randomAmounts = [100n, 5555n, 123456n, 1000000000n, 500000n];
      for (let i = 0; i < randomAmounts.length; i++) {
        const amt = randomAmounts[i];
        const dummyCommitment = ethers.keccak256(ethers.toUtf8Bytes(`native-deposit-${i}`));
        await vault.connect(alice).shield(NATIVE_ASSET_ID, amt, dummyCommitment, { value: amt });
        expectedBalance += amt;

        const currentBalance = await ethers.provider.getBalance(await vault.getAddress());
        expect(currentBalance).to.equal(expectedBalance);
      }
    });

    it("conserves ERC20 token balances across multiple randomized deposits", async () => {
      let expectedTokenBalance = 0n;
      const initialTokenBalance = await token.balanceOf(await vault.getAddress());
      expect(initialTokenBalance).to.equal(0n);

      const randomErc20Amounts = [50n, 100000n, 987654321n, ethers.parseEther("100")];
      for (let i = 0; i < randomErc20Amounts.length; i++) {
        const amt = randomErc20Amounts[i];
        const dummyCommitment = ethers.keccak256(ethers.toUtf8Bytes(`erc20-deposit-${i}`));
        await vault.connect(alice).shield(ERC20_ASSET_ID, amt, dummyCommitment);
        expectedTokenBalance += amt;

        const currentTokenBalance = await token.balanceOf(await vault.getAddress());
        expect(currentTokenBalance).to.equal(expectedTokenBalance);
      }
    });
  });

  describe("Invariant 2: Nullifier Invariance (Strict Double-Spend Replay Prevention)", () => {
    it("permanently marks a nullifier as spent and strictly prevents reuse under ANY condition", async () => {
      // Screen recipient
      await compliance.connect(admin).screen(WITHDRAW_RECIPIENT, true);

      await vault.connect(alice).shield(NATIVE_ASSET_ID, WITHDRAW_AMOUNT, WITHDRAW_COMMITMENT, { value: WITHDRAW_AMOUNT });
      const { proof, publicInputs } = loadFixture("withdraw", 5);
      const nullifier = publicInputs[1];

      expect(await vault.isSpentNullifier(nullifier)).to.equal(false);

      // Spend nullifier 1st time
      await vault.withdraw(proof, publicInputs[0], nullifier, WITHDRAW_AMOUNT, NATIVE_ASSET_ID, WITHDRAW_RECIPIENT);
      expect(await vault.isSpentNullifier(nullifier)).to.equal(true);

      // Attempt replay 1: Identical parameters
      await expect(
        vault.withdraw(proof, publicInputs[0], nullifier, WITHDRAW_AMOUNT, NATIVE_ASSET_ID, WITHDRAW_RECIPIENT)
      ).to.be.revertedWithCustomError(vault, "NullifierAlreadySpent");

      // Attempt replay 2: Different recipient
      await expect(
        vault.withdraw(proof, publicInputs[0], nullifier, WITHDRAW_AMOUNT, NATIVE_ASSET_ID, bob.address)
      ).to.be.revertedWithCustomError(vault, "NullifierAlreadySpent");

      // Attempt replay 3: Different caller
      await expect(
        vault.connect(charlie).withdraw(proof, publicInputs[0], nullifier, WITHDRAW_AMOUNT, NATIVE_ASSET_ID, WITHDRAW_RECIPIENT)
      ).to.be.revertedWithCustomError(vault, "NullifierAlreadySpent");

      // Attempt replay 4: In pay() (signature: proof, root, nullifierHash, assetId, outCommitment)
      await expect(
        vault.connect(alice).pay(proof, publicInputs[0], nullifier, NATIVE_ASSET_ID, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(vault, "NullifierAlreadySpent");

      // Attempt replay 5: In placeOrder() (signature: proof, root, nullifierHash, orderCommitment)
      await expect(
        vault.connect(alice).placeOrder(proof, publicInputs[0], nullifier, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(vault, "NullifierAlreadySpent");
    });
  });

  describe("Invariant 3: Compliance Gate Enforcement", () => {
    it("strictly blocks withdrawal if recipient is unscreened or blacklisted", async () => {
      await vault.connect(alice).shield(NATIVE_ASSET_ID, WITHDRAW_AMOUNT, WITHDRAW_COMMITMENT, { value: WITHDRAW_AMOUNT });
      const { proof, publicInputs } = loadFixture("withdraw", 5);

      // 1. Unscreened recipient -> MUST revert
      expect(await compliance.isScreened(WITHDRAW_RECIPIENT)).to.equal(false);
      await expect(
        vault.withdraw(proof, publicInputs[0], publicInputs[1], WITHDRAW_AMOUNT, NATIVE_ASSET_ID, WITHDRAW_RECIPIENT)
      ).to.be.revertedWithCustomError(vault, "RecipientNotScreened")
        .withArgs(WITHDRAW_RECIPIENT);

      // 2. Blacklisted recipient (clear = false) -> MUST revert
      await compliance.connect(admin).screen(WITHDRAW_RECIPIENT, false);
      expect(await compliance.isScreened(WITHDRAW_RECIPIENT)).to.equal(false);
      await expect(
        vault.withdraw(proof, publicInputs[0], publicInputs[1], WITHDRAW_AMOUNT, NATIVE_ASSET_ID, WITHDRAW_RECIPIENT)
      ).to.be.revertedWithCustomError(vault, "RecipientNotScreened")
        .withArgs(WITHDRAW_RECIPIENT);

      // 3. Clear recipient (clear = true) -> MUST succeed
      await compliance.connect(admin).screen(WITHDRAW_RECIPIENT, true);
      expect(await compliance.isScreened(WITHDRAW_RECIPIENT)).to.equal(true);
      await expect(
        vault.withdraw(proof, publicInputs[0], publicInputs[1], WITHDRAW_AMOUNT, NATIVE_ASSET_ID, WITHDRAW_RECIPIENT)
      ).to.not.be.reverted;
    });
  });

  describe("Invariant 4: Merkle Root Membership Gate", () => {
    it("strictly rejects any unknown or forged Merkle root across all proof operations", async () => {
      const { proof, publicInputs } = loadFixture("withdraw", 5);
      const fakeRoot = "0x2222222222222222222222222222222222222222222222222222222222222222";

      expect(await vault.isKnownRoot(fakeRoot)).to.equal(false);

      await expect(
        vault.withdraw(proof, fakeRoot, publicInputs[1], WITHDRAW_AMOUNT, NATIVE_ASSET_ID, WITHDRAW_RECIPIENT)
      ).to.be.revertedWithCustomError(vault, "UnknownRoot")
        .withArgs(fakeRoot);

      await expect(
        vault.connect(alice).pay(proof, fakeRoot, publicInputs[1], NATIVE_ASSET_ID, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(vault, "UnknownRoot")
        .withArgs(fakeRoot);

      await expect(
        vault.connect(alice).placeOrder(proof, fakeRoot, publicInputs[1], ethers.ZeroHash)
      ).to.be.revertedWithCustomError(vault, "UnknownRoot")
        .withArgs(fakeRoot);
    });
  });

  describe("Property Fuzzing: Shield Parameter Boundaries", () => {
    it("fuzzes non-allowlisted asset IDs to confirm unconditional rejection", async () => {
      const unallowlistedIds = [2n, 3n, 42n, 999999n, ethers.MaxUint256];
      for (const badAssetId of unallowlistedIds) {
        await expect(
          vault.connect(alice).shield(badAssetId, 100n, ethers.ZeroHash)
        ).to.be.revertedWithCustomError(vault, "AssetNotAllowed")
          .withArgs(badAssetId);
      }
    });

    it("fuzzes native value mismatches on native and ERC20 shield calls", async () => {
      const commitment = ethers.keccak256(ethers.toUtf8Bytes("mismatch-test"));

      // 1. Native asset but msg.value != amount
      await expect(
        vault.connect(alice).shield(NATIVE_ASSET_ID, 1000n, commitment, { value: 999n })
      ).to.be.revertedWithCustomError(vault, "NativeAmountMismatch")
        .withArgs(1000n, 999n);

      await expect(
        vault.connect(alice).shield(NATIVE_ASSET_ID, 1000n, commitment, { value: 1001n })
      ).to.be.revertedWithCustomError(vault, "NativeAmountMismatch")
        .withArgs(1000n, 1001n);

      await expect(
        vault.connect(alice).shield(NATIVE_ASSET_ID, 1000n, commitment, { value: 0n })
      ).to.be.revertedWithCustomError(vault, "NativeAmountMismatch")
        .withArgs(1000n, 0n);

      // 2. ERC20 asset but msg.value > 0
      await expect(
        vault.connect(alice).shield(ERC20_ASSET_ID, 1000n, commitment, { value: 1n })
      ).to.be.revertedWithCustomError(vault, "NativeAmountMismatch")
        .withArgs(0n, 1n);
    });
  });
});

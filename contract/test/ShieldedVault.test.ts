import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ShieldedVault, ComplianceRegistry, MockERC20 } from "../typechain-types";

// Real proof/public-input fixtures, generated once via the WSL nargo/bb
// pipeline (circuits/README.md) and already independently verified on-chain
// (circuits/scripts/noir-onchain-verify.ts) before being used here. Committed
// under circuits/noir/*/fixtures/ (unlike the rest of target/, which is
// gitignored build output) specifically so `npm test` works on a fresh
// clone without needing WSL/nargo/bb installed. Each fixture is a
// single-leaf tree — the matching `shield()` call below inserts the exact
// same commitment, so the resulting on-chain root lines up.
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

// withdraw fixture: spendingKey=111, blinding=999, amount=1000, assetId=0,
// recipient=0x70997970c51812dc3a010c7d01b50e0d17dc79c8
const WITHDRAW_COMMITMENT = "0x1558e1fa811a3e586c2ca3b6d3fe47681eaf479bc5bb69a83fb4505018672fad";
const WITHDRAW_RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const WITHDRAW_AMOUNT = 1000n;
const WITHDRAW_ASSET_ID = 0n;

// pay fixture: spendingKey=777, blinding=888, amount=250, assetId=1
const PAY_COMMITMENT = "0x1929824ee9247cdc3276330ad6e4fdc5f9050f4c040c6f6942284f9981e0b393";
const PAY_AMOUNT = 250n;
const PAY_ASSET_ID = 1n;

// place_order fixture: spendingKey=5002, blinding=6002, amount=450, assetId=1
// — its own note, independent of the withdraw/pay fixtures above.
const PLACE_ORDER_COMMITMENT = "0x129c6250bd178cae0c407b4120f70582f3a12166d20f40f3182b62aca8a0348e";
const PLACE_ORDER_AMOUNT = 450n;
const PLACE_ORDER_ASSET_ID = 1n;

// Opaque namespace tag for depositExternal's sourceChainId — this is a
// ShieldedVault-side bookkeeping key only, not read by the circuit itself
// (see circuits/BTC_DEPOSIT_DESIGN.md's "Public-input interface" section
// and ShieldedVault.sol's setTrustedVerifier doc for why the checkpoint
// commitment equality check, not this tag, is what does the real work).
const BTC_SIGNET_SOURCE_CHAIN_ID = ethers.keccak256(ethers.toUtf8Bytes("BTC_SIGNET"));

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

describe("ShieldedVault (real Noir/UltraHonk circuits)", function () {
  this.timeout(60_000);

  let vault: ShieldedVault;
  let token: MockERC20;
  let compliance: ComplianceRegistry;
  let admin: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let btcDepositVerifierAddress: string;

  beforeEach(async () => {
    [admin, alice] = await ethers.getSigners();

    const hasher = await deployHasher();
    const withdrawVerifier = await deployHonkVerifier("WithdrawHonkVerifier", "WithdrawRelationsLib", "WithdrawZKTranscriptLib");
    const payVerifier = await deployHonkVerifier("PayHonkVerifier", "PayRelationsLib", "PayZKTranscriptLib");
    const placeOrderVerifier = await deployHonkVerifier("PlaceOrderHonkVerifier", "PlaceOrderRelationsLib", "PlaceOrderZKTranscriptLib");
    const cancelOrderVerifier = await deployHonkVerifier("CancelOrderHonkVerifier", "CancelOrderRelationsLib", "CancelOrderZKTranscriptLib");
    const matchOrdersVerifier = await deployHonkVerifier("MatchOrdersHonkVerifier", "MatchOrdersRelationsLib", "MatchOrdersZKTranscriptLib");
    const btcDepositVerifier = await deployHonkVerifier("BtcDepositHonkVerifier", "BtcDepositRelationsLib", "BtcDepositZKTranscriptLib");
    btcDepositVerifierAddress = await btcDepositVerifier.getAddress();

    const Vault = await ethers.getContractFactory("ShieldedVault");
    vault = await Vault.deploy(
      await hasher.getAddress(),
      await withdrawVerifier.getAddress(),
      await payVerifier.getAddress(),
      await placeOrderVerifier.getAddress(),
      await cancelOrderVerifier.getAddress(),
      await matchOrdersVerifier.getAddress(),
      admin.address,
      WITHDRAW_ASSET_ID // nativeAssetId — the withdraw fixture's assetId 0 doubles as "the native leg" here
    );

    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy("Mock Asset", "MOCK");
    // WITHDRAW_ASSET_ID (0) is the native asset — no ERC20 behind it, see
    // setAsset's own doc comment.
    await vault.connect(admin).setAsset(WITHDRAW_ASSET_ID, ethers.ZeroAddress, true);
    await vault.connect(admin).setAsset(PAY_ASSET_ID, await token.getAddress(), true);
    await token.mint(alice.address, ethers.parseEther("1000000"));
    await vault.connect(admin).setTrustedVerifier(btcDepositVerifierAddress, true);

    const Compliance = await ethers.getContractFactory("ComplianceRegistry");
    compliance = await Compliance.deploy(admin.address);
  });

  it("shield() rejects a non-allowlisted asset", async () => {
    await expect(vault.connect(alice).shield(99n, 100n, 1n)).to.be.revertedWithCustomError(vault, "AssetNotAllowed");
  });

  it("shields, then withdraws with a real Noir proof", async () => {
    await vault.connect(alice).shield(WITHDRAW_ASSET_ID, WITHDRAW_AMOUNT, WITHDRAW_COMMITMENT, { value: WITHDRAW_AMOUNT });

    const { proof, publicInputs } = loadFixture("withdraw", 5);
    expect(await vault.currentRoot()).to.equal(publicInputs[0], "on-chain root must match the fixture's tree state");

    // WITHDRAW_RECIPIENT happens to be Hardhat's well-known default account
    // #1 (same address as `alice`, who has a real ETH balance from the
    // Hardhat network's own funding) — assert the delta, not an absolute
    // balance, to not conflate the two.
    const before = await ethers.provider.getBalance(WITHDRAW_RECIPIENT);

    await expect(vault.withdraw(proof, publicInputs[0], publicInputs[1], WITHDRAW_AMOUNT, WITHDRAW_ASSET_ID, WITHDRAW_RECIPIENT))
      .to.emit(vault, "Withdrawn")
      .withArgs(WITHDRAW_ASSET_ID, publicInputs[1], WITHDRAW_RECIPIENT, WITHDRAW_AMOUNT);

    expect(await ethers.provider.getBalance(WITHDRAW_RECIPIENT)).to.equal(before + WITHDRAW_AMOUNT);
    expect(await vault.isSpentNullifier(publicInputs[1])).to.equal(true);
  });

  it("rejects replaying the same nullifier", async () => {
    await vault.connect(alice).shield(WITHDRAW_ASSET_ID, WITHDRAW_AMOUNT, WITHDRAW_COMMITMENT, { value: WITHDRAW_AMOUNT });
    const { proof, publicInputs } = loadFixture("withdraw", 5);

    await vault.withdraw(proof, publicInputs[0], publicInputs[1], WITHDRAW_AMOUNT, WITHDRAW_ASSET_ID, WITHDRAW_RECIPIENT);
    await expect(
      vault.withdraw(proof, publicInputs[0], publicInputs[1], WITHDRAW_AMOUNT, WITHDRAW_ASSET_ID, WITHDRAW_RECIPIENT)
    ).to.be.revertedWithCustomError(vault, "NullifierAlreadySpent");
  });

  it("rejects a tampered proof (wrong amount)", async () => {
    await vault.connect(alice).shield(WITHDRAW_ASSET_ID, WITHDRAW_AMOUNT, WITHDRAW_COMMITMENT, { value: WITHDRAW_AMOUNT });
    const { proof, publicInputs } = loadFixture("withdraw", 5);

    await expect(
      vault.withdraw(proof, publicInputs[0], publicInputs[1], WITHDRAW_AMOUNT + 1n, WITHDRAW_ASSET_ID, WITHDRAW_RECIPIENT)
    ).to.be.reverted;
  });

  it("blocks withdrawal to a recipient that fails compliance screening", async () => {
    await vault.connect(admin).setComplianceRegistry(await compliance.getAddress());
    await compliance.grantRole(await compliance.ATTESTER_ROLE(), admin.address);
    await compliance.connect(admin).screen(WITHDRAW_RECIPIENT, false);

    await vault.connect(alice).shield(WITHDRAW_ASSET_ID, WITHDRAW_AMOUNT, WITHDRAW_COMMITMENT, { value: WITHDRAW_AMOUNT });
    const { proof, publicInputs } = loadFixture("withdraw", 5);

    await expect(
      vault.withdraw(proof, publicInputs[0], publicInputs[1], WITHDRAW_AMOUNT, WITHDRAW_ASSET_ID, WITHDRAW_RECIPIENT)
    ).to.be.revertedWithCustomError(vault, "RecipientNotScreened");
  });

  it("shield() rejects native value that doesn't match the declared amount", async () => {
    await expect(
      vault.connect(alice).shield(WITHDRAW_ASSET_ID, WITHDRAW_AMOUNT, WITHDRAW_COMMITMENT, { value: WITHDRAW_AMOUNT - 1n })
    ).to.be.revertedWithCustomError(vault, "NativeAmountMismatch");
  });

  it("shield() rejects native value sent alongside a non-native (ERC20) asset", async () => {
    await token.connect(alice).approve(await vault.getAddress(), PAY_AMOUNT);
    await expect(
      vault.connect(alice).shield(PAY_ASSET_ID, PAY_AMOUNT, PAY_COMMITMENT, { value: 1n })
    ).to.be.revertedWithCustomError(vault, "NativeAmountMismatch");
  });

  it("pays privately — spends one note, creates a new hidden one, no ERC20 leaves the vault", async () => {
    await token.connect(alice).approve(await vault.getAddress(), PAY_AMOUNT);
    await vault.connect(alice).shield(PAY_ASSET_ID, PAY_AMOUNT, PAY_COMMITMENT);

    const { proof, publicInputs } = loadFixture("pay", 4);
    expect(await vault.currentRoot()).to.equal(publicInputs[0], "on-chain root must match the fixture's tree state");

    const vaultBalanceBefore = await token.balanceOf(await vault.getAddress());
    const outCommitment = publicInputs[3];

    await expect(vault.pay(proof, publicInputs[0], publicInputs[1], PAY_ASSET_ID, outCommitment)).to.emit(
      vault,
      "Paid"
    );

    expect(await token.balanceOf(await vault.getAddress())).to.equal(vaultBalanceBefore);
    expect(await vault.isSpentNullifier(publicInputs[1])).to.equal(true);
    expect(await vault.isKnownRoot(await vault.currentRoot())).to.equal(true);
  });

  it("pay() succeeds for an assetId marked external-source even after its isAllowedAsset entry is revoked", async () => {
    // Real BTC never has an isAllowedAsset entry at all (only
    // isExternalSourceAsset — see setExternalSourceAsset's own NatSpec).
    // Reusing PAY_ASSET_ID/the real pay fixture here (rather than needing a
    // second real proof for a second assetId) still exercises the exact
    // code path that matters: shield() first (which does need
    // isAllowedAsset, unconditionally — external assets are minted via
    // depositExternal instead, never shield()), then revoking
    // isAllowedAsset and marking external-source in its place, then
    // confirming pay() doesn't fall back to requiring the revoked flag.
    await token.connect(alice).approve(await vault.getAddress(), PAY_AMOUNT);
    await vault.connect(alice).shield(PAY_ASSET_ID, PAY_AMOUNT, PAY_COMMITMENT);

    await vault.connect(admin).setExternalSourceAsset(PAY_ASSET_ID, true);
    await vault.connect(admin).setAsset(PAY_ASSET_ID, await token.getAddress(), false);
    expect(await vault.isAllowedAsset(PAY_ASSET_ID)).to.equal(false);

    const { proof, publicInputs } = loadFixture("pay", 4);
    const outCommitment = publicInputs[3];

    await expect(vault.pay(proof, publicInputs[0], publicInputs[1], PAY_ASSET_ID, outCommitment)).to.emit(
      vault,
      "Paid"
    );
  });

  it("pay() still rejects an assetId that's neither allowlisted nor external-source", async () => {
    await token.connect(alice).approve(await vault.getAddress(), PAY_AMOUNT);
    await vault.connect(alice).shield(PAY_ASSET_ID, PAY_AMOUNT, PAY_COMMITMENT);
    await vault.connect(admin).setAsset(PAY_ASSET_ID, await token.getAddress(), false);

    const { proof, publicInputs } = loadFixture("pay", 4);
    const outCommitment = publicInputs[3];

    await expect(
      vault.pay(proof, publicInputs[0], publicInputs[1], PAY_ASSET_ID, outCommitment)
    ).to.be.revertedWithCustomError(vault, "AssetNotAllowed");
  });

  it("places a dark-pool order — spends a regular note, creates a hidden order commitment", async () => {
    await token.connect(alice).approve(await vault.getAddress(), PLACE_ORDER_AMOUNT);
    await vault.connect(alice).shield(PLACE_ORDER_ASSET_ID, PLACE_ORDER_AMOUNT, PLACE_ORDER_COMMITMENT);

    const { proof, publicInputs } = loadFixture("place_order", 3);
    expect(await vault.currentRoot()).to.equal(publicInputs[0], "on-chain root must match the fixture's tree state");

    const rootBefore = await vault.currentRoot();
    const orderCommitment = publicInputs[2];
    const tx = await vault.placeOrder(proof, publicInputs[0], publicInputs[1], orderCommitment);
    const receipt = await tx.wait();
    const event = receipt!.logs
      .map((log) => { try { return vault.interface.parseLog(log); } catch { return null; } })
      .find((parsed) => parsed?.name === "OrderPlaced");

    expect(event, "OrderPlaced event must be emitted").to.not.be.undefined;
    expect(event!.args.nullifierHash).to.equal(publicInputs[1]);
    expect(event!.args.orderCommitment).to.equal(orderCommitment);
    expect(event!.args.leafIndex).to.equal(1n);
    expect(event!.args.newRoot).to.not.equal(rootBefore, "root must change after inserting the order commitment");
    expect(await vault.currentRoot()).to.equal(event!.args.newRoot);
    expect(await vault.isSpentNullifier(publicInputs[1])).to.equal(true);
  });

  it("mints a note from a real BTC deposit proof via depositExternal", async () => {
    // btc_deposit fixture public inputs, in circuit-declared order:
    // (checkpoint_commitment_pub, note_commitment, nullifier) — see
    // circuits/BTC_DEPOSIT_DESIGN.md.
    const { proof, publicInputs } = loadFixture("btc_deposit", 3);
    const [checkpointRoot, noteCommitment, nullifier] = publicInputs;
    await vault.connect(admin).setCheckpoint(BTC_SIGNET_SOURCE_CHAIN_ID, checkpointRoot);

    const rootBefore = await vault.currentRoot();
    const tx = await vault.depositExternal(btcDepositVerifierAddress, proof, {
      sourceChainId: BTC_SIGNET_SOURCE_CHAIN_ID,
      checkpointRoot,
      noteCommitment,
      nullifier,
    });
    const receipt = await tx.wait();
    const event = receipt!.logs
      .map((log) => { try { return vault.interface.parseLog(log); } catch { return null; } })
      .find((parsed) => parsed?.name === "ExternalDeposited");

    expect(event, "ExternalDeposited event must be emitted").to.not.be.undefined;
    expect(event!.args.sourceChainId).to.equal(BTC_SIGNET_SOURCE_CHAIN_ID);
    expect(event!.args.nullifier).to.equal(nullifier);
    expect(event!.args.noteCommitment).to.equal(BigInt(noteCommitment));
    expect(event!.args.newRoot).to.not.equal(rootBefore, "root must change after inserting the note commitment");
    expect(await vault.currentRoot()).to.equal(event!.args.newRoot);
    expect(await vault.isSpentNullifier(BigInt(nullifier))).to.equal(true);
  });

  it("depositExternal rejects a verifier that was never trusted", async () => {
    const { proof, publicInputs } = loadFixture("btc_deposit", 3);
    const [checkpointRoot, noteCommitment, nullifier] = publicInputs;
    await vault.connect(admin).setCheckpoint(BTC_SIGNET_SOURCE_CHAIN_ID, checkpointRoot);

    await expect(
      vault.depositExternal(alice.address /* not a registered verifier */, proof, {
        sourceChainId: BTC_SIGNET_SOURCE_CHAIN_ID,
        checkpointRoot,
        noteCommitment,
        nullifier,
      })
    ).to.be.revertedWithCustomError(vault, "UnknownVerifier");
  });

  it("depositExternal rejects a checkpointRoot that doesn't match the registered checkpoint", async () => {
    const { proof, publicInputs } = loadFixture("btc_deposit", 3);
    const [checkpointRoot, noteCommitment, nullifier] = publicInputs;
    // Deliberately not registering the real checkpoint — checkpoints[sourceChainId] stays its zero default.

    await expect(
      vault.depositExternal(btcDepositVerifierAddress, proof, {
        sourceChainId: BTC_SIGNET_SOURCE_CHAIN_ID,
        checkpointRoot,
        noteCommitment,
        nullifier,
      })
    ).to.be.revertedWithCustomError(vault, "StaleCheckpoint");
  });

  it("depositExternal rejects replaying the same nullifier", async () => {
    const { proof, publicInputs } = loadFixture("btc_deposit", 3);
    const [checkpointRoot, noteCommitment, nullifier] = publicInputs;
    await vault.connect(admin).setCheckpoint(BTC_SIGNET_SOURCE_CHAIN_ID, checkpointRoot);
    const deposit = { sourceChainId: BTC_SIGNET_SOURCE_CHAIN_ID, checkpointRoot, noteCommitment, nullifier };

    await vault.depositExternal(btcDepositVerifierAddress, proof, deposit);
    await expect(vault.depositExternal(btcDepositVerifierAddress, proof, deposit)).to.be.revertedWithCustomError(
      vault,
      "NullifierAlreadySpent"
    );
  });

  it("routes withdraw() to ExternalWithdrawalRequested for an assetId marked external-source, instead of transferring", async () => {
    await vault.connect(alice).shield(WITHDRAW_ASSET_ID, WITHDRAW_AMOUNT, WITHDRAW_COMMITMENT, { value: WITHDRAW_AMOUNT });
    const { proof, publicInputs } = loadFixture("withdraw", 5);

    // Artificially marks the *native* asset external-source purely to
    // exercise the branch with a real proof (WITHDRAW_ASSET_ID isn't
    // really BTC) — the contract's branch logic only checks
    // isExternalSourceAsset[assetId], and the circuit itself doesn't know
    // or care which branch withdraw() takes with its own opaque
    // `recipient` public input (see withdraw()'s own NatSpec).
    await vault.connect(admin).setExternalSourceAsset(WITHDRAW_ASSET_ID, true);

    const before = await ethers.provider.getBalance(WITHDRAW_RECIPIENT);
    const tx = vault.withdraw(proof, publicInputs[0], publicInputs[1], WITHDRAW_AMOUNT, WITHDRAW_ASSET_ID, WITHDRAW_RECIPIENT);

    await expect(tx)
      .to.emit(vault, "ExternalWithdrawalRequested")
      .withArgs(WITHDRAW_ASSET_ID, publicInputs[1], WITHDRAW_RECIPIENT, WITHDRAW_AMOUNT);
    await expect(tx).to.not.emit(vault, "Withdrawn");

    // No native value moved — the entire point of this branch.
    expect(await ethers.provider.getBalance(WITHDRAW_RECIPIENT)).to.equal(before);
    expect(await vault.isSpentNullifier(publicInputs[1])).to.equal(true);
  });

  // cancelOrder and matchOrders each spend an order commitment that, in this
  // fixture, sits alone at leaf index 0 — a state that can't be reached
  // through the vault's real functions in a single step (placeOrder always
  // spends a *prior* note first, which itself occupies index 0). Chaining
  // fixtures to match a real multi-step on-chain sequence would need live
  // in-test proving (deferred — see circuits/README.md), so these two are
  // covered at the proof/verifier level instead: circuits/scripts/
  // noir-onchain-verify.ts independently confirms both circuits produce
  // real, on-chain-accepted proofs and correctly reject tampering. Not
  // covered here: the full vault-state integration for these two calls.
});

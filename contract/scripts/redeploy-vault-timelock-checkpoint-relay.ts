import { ethers } from "hardhat";

/**
 * Targeted redeploy for the admin-timelock + permissionless-checkpoint-relay
 * change: `setTrustedVerifier`/`setExternalDepositToken` are now
 * queue-then-execute (ADMIN_TIMELOCK_DELAY, currently 48h) instead of
 * instant single-admin-key writes, and `setCheckpoint` is gone entirely —
 * replaced by a one-time, timelocked, write-once `initializeCheckpoint`
 * genesis anchor plus a permissionless, proof-gated `extendCheckpoint` for
 * every update after that (see ShieldedVault.sol's own NatSpec and
 * docs/LIMITATIONS.md). ShieldedVault's constructor also gained a 7th
 * verifier arg (`checkpointRelayVerifier`) — an ABI break, hence a fresh
 * ShieldedVault deployment, same reasoning as every prior
 * `redeploy-vault-*.ts` in this history.
 *
 * Reuses ALL SIX already-deployed action/deposit verifiers (withdraw/pay/
 * placeOrder/cancelOrder/matchOrders/btcDeposit — no circuit among them
 * changed) plus Poseidon2/ComplianceRegistry/WrappedBTC, same
 * reasoning as `redeploy-vault-pay-fix.ts`. New this time:
 * `CheckpointRelayHonkVerifier` (new circuit, see
 * circuits/noir/checkpoint_relay) and `ShieldedVault` itself.
 *
 * Does NOT call `executeSetTrustedVerifier`/`executeSetExternalDepositToken`
 * or `initializeCheckpoint` — only queues the first two (their own execute
 * calls must be run separately, at least ADMIN_TIMELOCK_DELAY later, with
 * the identical args printed below). Checkpoint genesis bootstrap is
 * `scripts/initialize-btc-checkpoint.ts`'s own job, run once this vault
 * address is live and its own queue's delay has elapsed too.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const NATIVE_ASSET_ID = 0;
  const BTC_ASSET_ID = 999; // must match contract/circuits/noir/btc_deposit/src/bitcoin.nr's BTC_ASSET_ID exactly
  const BTC_SIGNET_SOURCE_CHAIN_ID = ethers.keccak256(ethers.toUtf8Bytes("BTC_SIGNET"));
  const EXISTING = {
    hasher: "0x94d22070FfDB39a9dAEc0a9B5b367111e74dF071",
    withdrawVerifier: "0xa3410943004c2b537C48e76F8A9eeE8aA71df40c",
    payVerifier: "0xF7aC6d4A281cf9c117380B5c8E238d466943cFC3",
    placeOrderVerifier: "0xbdB988FBc849499bcdF42951FD67792357B34d2D",
    cancelOrderVerifier: "0xcBa1edd6b9D9f799BF172C14803CB14b89715Dd7",
    matchOrdersVerifier: "0x22A3B97BA38013BA44B91a9baE72094A751a318A",
    btcDepositVerifier: "0xfC5561cbec08b9674D3EE4cf5943b83eA62774EA",
    wrappedBtc: "0x0E8012D34cCcE7252b680cE96b36f514C5D2Bd04",
    complianceRegistry: "0xC9192Ecaf662c977B28c614e49F558AAAB832577",
  };
  const erc20Assets: { assetId: number; address: string }[] = [
    { assetId: 1, address: "0x0b6A3645c240605887a5532109323A3E12273dc7" }, // FXRP
    { assetId: 2, address: "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F" }, // USDT0
  ];

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
    console.log(`${contractName}:`, await verifier.getAddress());
    return verifier;
  }

  const checkpointRelayVerifier = await deployHonkVerifier(
    "CheckpointRelayHonkVerifier",
    "CheckpointRelayRelationsLib",
    "CheckpointRelayZKTranscriptLib"
  );

  const Vault = await ethers.getContractFactory("ShieldedVault");
  const vault = await Vault.deploy(
    EXISTING.hasher,
    EXISTING.withdrawVerifier,
    EXISTING.payVerifier,
    EXISTING.placeOrderVerifier,
    EXISTING.cancelOrderVerifier,
    EXISTING.matchOrdersVerifier,
    await checkpointRelayVerifier.getAddress(),
    deployer.address,
    NATIVE_ASSET_ID
  );
  await vault.waitForDeployment();
  console.log("ShieldedVault:", await vault.getAddress());

  console.log("Wiring...");
  await (await vault.setComplianceRegistry(EXISTING.complianceRegistry)).wait();

  await (await vault.queueSetTrustedVerifier(EXISTING.btcDepositVerifier, true)).wait();
  console.log("Queued trusting BtcDepositHonkVerifier for depositExternal.");

  const wrappedBtc = await ethers.getContractAt("WrappedBTC", EXISTING.wrappedBtc);
  await (await wrappedBtc.connect(deployer).grantRole(await wrappedBtc.MINTER_ROLE(), await vault.getAddress())).wait();
  console.log("Granted the new ShieldedVault MINTER_ROLE on WrappedBTC.");

  await (await vault.queueSetExternalDepositToken(BTC_SIGNET_SOURCE_CHAIN_ID, EXISTING.wrappedBtc)).wait();
  console.log("Queued registering WrappedBTC as depositExternal's mint target.");

  await (await vault.setAsset(NATIVE_ASSET_ID, ethers.ZeroAddress, true)).wait();
  console.log(`Allowlisted assetId ${NATIVE_ASSET_ID}: native C2FLR`);

  await (await vault.setAsset(BTC_ASSET_ID, EXISTING.wrappedBtc, true)).wait();
  console.log(`Allowlisted assetId ${BTC_ASSET_ID} (BTC): WrappedBTC`);

  for (const { assetId, address } of erc20Assets) {
    await (await vault.setAsset(assetId, address, true)).wait();
    console.log(`Allowlisted assetId ${assetId}:`, address);
  }

  console.log("\nNEXT STEPS (after ADMIN_TIMELOCK_DELAY has elapsed, with the IDENTICAL args used above):");
  console.log(`  vault.executeSetTrustedVerifier("${EXISTING.btcDepositVerifier}", true)`);
  console.log(`  vault.executeSetExternalDepositToken("${BTC_SIGNET_SOURCE_CHAIN_ID}", "${EXISTING.wrappedBtc}")`);
  console.log("Then run scripts/initialize-btc-checkpoint.ts to bootstrap the genesis checkpoint (its own");
  console.log("queue/execute pair, on the same delay) — BTC deposits stay unavailable until all three have executed.");

  console.log("\nDeployment summary");
  console.table({
    Poseidon2_BN254: EXISTING.hasher,
    WithdrawHonkVerifier: EXISTING.withdrawVerifier,
    PayHonkVerifier: EXISTING.payVerifier,
    PlaceOrderHonkVerifier: EXISTING.placeOrderVerifier,
    CancelOrderHonkVerifier: EXISTING.cancelOrderVerifier,
    MatchOrdersHonkVerifier: EXISTING.matchOrdersVerifier,
    BtcDepositHonkVerifier: EXISTING.btcDepositVerifier,
    CheckpointRelayHonkVerifier: await checkpointRelayVerifier.getAddress(),
    WrappedBTC: EXISTING.wrappedBtc,
    ShieldedVault: await vault.getAddress(),
    ComplianceRegistry: EXISTING.complianceRegistry,
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

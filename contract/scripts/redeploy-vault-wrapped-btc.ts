import { ethers } from "hardhat";

/**
 * Redeploy for the public-WrappedBTC rebuild: `btc_deposit`'s circuit now
 * binds a real EVM recipient address + amount instead of a private note
 * commitment (see circuits/noir/btc_deposit/src/bitcoin.nr), so
 * `depositExternal`'s `ExternalDeposit` struct and public-input order both
 * changed — an ABI break on a non-upgradeable contract, so `ShieldedVault`
 * itself must be redeployed. Reuses ALL FIVE byte-for-byte-unchanged
 * verifiers (withdraw/pay/placeOrder/cancelOrder/matchOrders) plus
 * Poseidon2/ComplianceRegistry/StealthAnnouncer/OwnerKeyRegistry, same
 * reasoning as `redeploy-vault-btc.ts`. New this time: `BtcDepositHonkVerifier`
 * (new circuit bytecode) and `WrappedBTC` (new — real ERC20 collateral BTC
 * deposits mint into directly). `BatchWithdrawer` takes the vault address
 * as a call argument, not a constructor argument (see its own NatSpec), so
 * it does NOT need redeploying despite the new vault address.
 *
 * BTC (assetId 999) is now ordinary allowlisted collateral — real WrappedBTC
 * sits in the vault once shielded, exactly like FXRP/USDT0 — so this script
 * does NOT call `setExternalSourceAsset` for it (unlike `redeploy-vault-btc.ts`).
 *
 * Deliberately does NOT call `setCheckpoint` — see `deploy.ts`'s own
 * comment; that's `scripts/refresh-btc-checkpoint.ts`'s job, run separately
 * once this vault address is live.
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

  const btcDepositVerifier = await deployHonkVerifier("BtcDepositHonkVerifier", "BtcDepositRelationsLib", "BtcDepositZKTranscriptLib");

  const WrappedBTC = await ethers.getContractFactory("WrappedBTC");
  const wrappedBtc = await WrappedBTC.deploy(deployer.address);
  await wrappedBtc.waitForDeployment();
  console.log("WrappedBTC:", await wrappedBtc.getAddress());

  const Vault = await ethers.getContractFactory("ShieldedVault");
  const vault = await Vault.deploy(
    EXISTING.hasher,
    EXISTING.withdrawVerifier,
    EXISTING.payVerifier,
    EXISTING.placeOrderVerifier,
    EXISTING.cancelOrderVerifier,
    EXISTING.matchOrdersVerifier,
    deployer.address,
    NATIVE_ASSET_ID
  );
  await vault.waitForDeployment();
  console.log("ShieldedVault:", await vault.getAddress());

  console.log("Wiring...");
  await (await vault.setComplianceRegistry(EXISTING.complianceRegistry)).wait();

  await (await vault.setTrustedVerifier(await btcDepositVerifier.getAddress(), true)).wait();
  console.log("Trusted BtcDepositHonkVerifier for depositExternal.");

  await (await wrappedBtc.grantRole(await wrappedBtc.MINTER_ROLE(), await vault.getAddress())).wait();
  console.log("Granted ShieldedVault MINTER_ROLE on WrappedBTC.");

  await (await vault.setExternalDepositToken(BTC_SIGNET_SOURCE_CHAIN_ID, await wrappedBtc.getAddress())).wait();
  console.log(`Registered WrappedBTC as depositExternal's mint target for sourceChainId ${BTC_SIGNET_SOURCE_CHAIN_ID}.`);
  console.log("NOTE: checkpoints[BTC_SIGNET_SOURCE_CHAIN_ID] is still unset — run scripts/refresh-btc-checkpoint.ts next.");

  await (await vault.setAsset(NATIVE_ASSET_ID, ethers.ZeroAddress, true)).wait();
  console.log(`Allowlisted assetId ${NATIVE_ASSET_ID}: native C2FLR`);

  await (await vault.setAsset(BTC_ASSET_ID, await wrappedBtc.getAddress(), true)).wait();
  console.log(`Allowlisted assetId ${BTC_ASSET_ID} (BTC): WrappedBTC — real collateral now, shield/withdraw/pay/dark-pool all work like any other asset.`);

  for (const { assetId, address } of erc20Assets) {
    await (await vault.setAsset(assetId, address, true)).wait();
    console.log(`Allowlisted assetId ${assetId}:`, address);
  }

  console.log("\nDeployment summary");
  console.table({
    Poseidon2_BN254: EXISTING.hasher,
    WithdrawHonkVerifier: EXISTING.withdrawVerifier,
    PayHonkVerifier: EXISTING.payVerifier,
    PlaceOrderHonkVerifier: EXISTING.placeOrderVerifier,
    CancelOrderHonkVerifier: EXISTING.cancelOrderVerifier,
    MatchOrdersHonkVerifier: EXISTING.matchOrdersVerifier,
    BtcDepositHonkVerifier: await btcDepositVerifier.getAddress(),
    WrappedBTC: await wrappedBtc.getAddress(),
    ShieldedVault: await vault.getAddress(),
    ComplianceRegistry: EXISTING.complianceRegistry,
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

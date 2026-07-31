import { ethers } from "hardhat";

/**
 * Targeted redeploy for the native-C2FLR change: shield()/withdraw() now
 * hold/pay native value directly for assetId 0 instead of requiring an
 * ERC20 — a ShieldedVault-only change (see contracts/ShieldedVault.sol).
 * No circuit changed at all (assetId/amount are opaque Field values to
 * every circuit, regardless of what backs them on-chain), so this reuses
 * ALL FIVE already-deployed, byte-for-byte-unchanged verifiers, plus
 * Poseidon2/ComplianceRegistry/StealthAnnouncer/OwnerKeyRegistry — only
 * ShieldedVault itself gets a fresh deployment.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const NATIVE_ASSET_ID = 0;
  const EXISTING = {
    hasher: "0x94d22070FfDB39a9dAEc0a9B5b367111e74dF071",
    withdrawVerifier: "0xa3410943004c2b537C48e76F8A9eeE8aA71df40c",
    payVerifier: "0xF7aC6d4A281cf9c117380B5c8E238d466943cFC3",
    placeOrderVerifier: "0xbdB988FBc849499bcdF42951FD67792357B34d2D",
    cancelOrderVerifier: "0xcBa1edd6b9D9f799BF172C14803CB14b89715Dd7",
    matchOrdersVerifier: "0x22A3B97BA38013BA44B91a9baE72094A751a318A",
    complianceRegistry: "0xC9192Ecaf662c977B28c614e49F558AAAB832577",
  };
  // Native C2FLR (assetId 0) needs no token address at all. FXRP/USDT0
  // stay real ERC20s, unaffected by this change.
  const erc20Assets: { assetId: number; address: string }[] = [
    { assetId: 1, address: "0x0b6A3645c240605887a5532109323A3E12273dc7" }, // FXRP
    { assetId: 2, address: "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F" }, // USDT0
  ];

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

  await (await vault.setAsset(NATIVE_ASSET_ID, ethers.ZeroAddress, true)).wait();
  console.log(`Allowlisted assetId ${NATIVE_ASSET_ID}: native C2FLR`);

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
    ShieldedVault: await vault.getAddress(),
    ComplianceRegistry: EXISTING.complianceRegistry,
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

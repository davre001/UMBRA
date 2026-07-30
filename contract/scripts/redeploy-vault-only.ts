import { ethers } from "hardhat";

/**
 * Targeted redeploy for the partial-fills change: only place_order,
 * cancel_order, match_orders, and ShieldedVault itself actually changed.
 * Reuses the already-deployed, byte-for-byte-unchanged Poseidon2 hasher,
 * WithdrawHonkVerifier, PayHonkVerifier, ComplianceRegistry,
 * StealthAnnouncer, and OwnerKeyRegistry instead of redeploying them —
 * cheaper, and avoids orphaning anyone who already registered an ownerKey
 * on the existing OwnerKeyRegistry (a full fresh deploy would reset it).
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const EXISTING = {
    hasher: "0x94d22070FfDB39a9dAEc0a9B5b367111e74dF071",
    withdrawVerifier: "0xa3410943004c2b537C48e76F8A9eeE8aA71df40c",
    payVerifier: "0xF7aC6d4A281cf9c117380B5c8E238d466943cFC3",
    complianceRegistry: "0xC9192Ecaf662c977B28c614e49F558AAAB832577",
  };
  const assets: { assetId: number; address: string }[] = [
    { assetId: 0, address: "0xC67DCE33D7A8efA5FfEB961899C73fe01bCe9273" }, // WFLR
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

  const placeOrderVerifier = await deployHonkVerifier("PlaceOrderHonkVerifier", "PlaceOrderRelationsLib", "PlaceOrderZKTranscriptLib");
  const cancelOrderVerifier = await deployHonkVerifier("CancelOrderHonkVerifier", "CancelOrderRelationsLib", "CancelOrderZKTranscriptLib");
  const matchOrdersVerifier = await deployHonkVerifier("MatchOrdersHonkVerifier", "MatchOrdersRelationsLib", "MatchOrdersZKTranscriptLib");

  const Vault = await ethers.getContractFactory("ShieldedVault");
  const vault = await Vault.deploy(
    EXISTING.hasher,
    EXISTING.withdrawVerifier,
    EXISTING.payVerifier,
    await placeOrderVerifier.getAddress(),
    await cancelOrderVerifier.getAddress(),
    await matchOrdersVerifier.getAddress(),
    deployer.address
  );
  await vault.waitForDeployment();
  console.log("ShieldedVault:", await vault.getAddress());

  console.log("Wiring...");
  await (await vault.setComplianceRegistry(EXISTING.complianceRegistry)).wait();
  for (const { assetId, address } of assets) {
    await (await vault.setAsset(assetId, address, true)).wait();
    console.log(`Allowlisted assetId ${assetId}:`, address);
  }

  console.log("\nDeployment summary");
  console.table({
    Poseidon2_BN254: EXISTING.hasher,
    WithdrawHonkVerifier: EXISTING.withdrawVerifier,
    PayHonkVerifier: EXISTING.payVerifier,
    PlaceOrderHonkVerifier: await placeOrderVerifier.getAddress(),
    CancelOrderHonkVerifier: await cancelOrderVerifier.getAddress(),
    MatchOrdersHonkVerifier: await matchOrdersVerifier.getAddress(),
    ShieldedVault: await vault.getAddress(),
    ComplianceRegistry: EXISTING.complianceRegistry,
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

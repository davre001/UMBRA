import { ethers } from "hardhat";

/**
 * Deploys the full Umbra contract set to whichever network Hardhat is pointed
 * at (`--network coston2`).
 *
 * Requires the circuits to already be compiled and set up once —
 * contracts/verifiers/*.sol (generated from circuits/noir/* via bb) must
 * exist. See circuits/README.md for the one-time setup commands.
 *
 * assetId 0 is native C2FLR — `shield`/`withdraw` hold/pay it directly
 * (any contract can hold native value, no wrapped-token contract involved
 * at all), so it needs no token address. Real ERC20 asset addresses (FXRP,
 * USDT0) are intentionally NOT hardcoded — per Flare's own guidance,
 * AssetManager/FAsset addresses should be resolved dynamically and can
 * change. Pass them via env vars once looked up on the Coston2 explorer
 * (https://coston2-explorer.flare.network); each gets the assetId matching
 * its position below (0 = native C2FLR, 1 = FXRP, 2 = USDT0) — the same
 * convention the frontend/circuits need to agree on. Any left unset are
 * skipped and can be allowlisted later via `vault.setAsset(assetId, token, true)`.
 *
 * ATTESTER_ADDRESS defaults to the deployer if unset — fine for a first
 * testnet deploy, but should be the backend's dedicated signing key in a
 * real setup, not the deployer key.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const NATIVE_ASSET_ID = 0;
  const attesterAddress = process.env.ATTESTER_ADDRESS ?? deployer.address;
  const erc20Assets: { assetId: number; address: string | undefined }[] = [
    { assetId: 1, address: process.env.FXRP_ADDRESS },
    { assetId: 2, address: process.env.USDT0_ADDRESS },
  ];

  // Poseidon2 — vendored, empirically-verified zemse/poseidon2-evm (see
  // contracts/lib/poseidon2/). Matches the Noir circuits' hash for the
  // Merkle tree's internal node combination; commitment/nullifier hashing
  // happens client-side only, never on-chain.
  const Poseidon2 = await ethers.getContractFactory("Poseidon2_BN254");
  const hasher = await Poseidon2.deploy();
  await hasher.waitForDeployment();
  console.log("Poseidon2_BN254 (hasher):", await hasher.getAddress());

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

  const withdrawVerifier = await deployHonkVerifier("WithdrawHonkVerifier", "WithdrawRelationsLib", "WithdrawZKTranscriptLib");
  const payVerifier = await deployHonkVerifier("PayHonkVerifier", "PayRelationsLib", "PayZKTranscriptLib");
  const placeOrderVerifier = await deployHonkVerifier("PlaceOrderHonkVerifier", "PlaceOrderRelationsLib", "PlaceOrderZKTranscriptLib");
  const cancelOrderVerifier = await deployHonkVerifier("CancelOrderHonkVerifier", "CancelOrderRelationsLib", "CancelOrderZKTranscriptLib");
  const matchOrdersVerifier = await deployHonkVerifier("MatchOrdersHonkVerifier", "MatchOrdersRelationsLib", "MatchOrdersZKTranscriptLib");

  const Vault = await ethers.getContractFactory("ShieldedVault");
  const vault = await Vault.deploy(
    await hasher.getAddress(),
    await withdrawVerifier.getAddress(),
    await payVerifier.getAddress(),
    await placeOrderVerifier.getAddress(),
    await cancelOrderVerifier.getAddress(),
    await matchOrdersVerifier.getAddress(),
    deployer.address,
    NATIVE_ASSET_ID
  );
  await vault.waitForDeployment();
  console.log("ShieldedVault:", await vault.getAddress());

  const Compliance = await ethers.getContractFactory("ComplianceRegistry");
  const compliance = await Compliance.deploy(deployer.address);
  await compliance.waitForDeployment();
  console.log("ComplianceRegistry:", await compliance.getAddress());

  const Announcer = await ethers.getContractFactory("StealthAnnouncer");
  const announcer = await Announcer.deploy();
  await announcer.waitForDeployment();
  console.log("StealthAnnouncer:", await announcer.getAddress());

  const OwnerKeyRegistry = await ethers.getContractFactory("OwnerKeyRegistry");
  const ownerKeyRegistry = await OwnerKeyRegistry.deploy();
  await ownerKeyRegistry.waitForDeployment();
  console.log("OwnerKeyRegistry:", await ownerKeyRegistry.getAddress());

  // UmbraForwarder deliberately not deployed here — unused, see its NatSpec:
  // no action on ShieldedVault needs meta-tx relaying, since the ZK proof
  // itself is already the authorization.

  console.log("Wiring...");
  await (await vault.setComplianceRegistry(await compliance.getAddress())).wait();
  await (await compliance.grantRole(await compliance.ATTESTER_ROLE(), attesterAddress)).wait();

  await (await vault.setAsset(NATIVE_ASSET_ID, ethers.ZeroAddress, true)).wait();
  console.log(`Allowlisted assetId ${NATIVE_ASSET_ID}: native C2FLR`);

  for (const { assetId, address } of erc20Assets) {
    if (!address) continue;
    await (await vault.setAsset(assetId, address, true)).wait();
    console.log(`Allowlisted assetId ${assetId}:`, address);
  }
  if (erc20Assets.every((a) => !a.address)) {
    console.log("No FXRP_ADDRESS/USDT0_ADDRESS set — allowlist them later via vault.setAsset(assetId, token, true).");
  }

  console.log("\nDeployment summary");
  console.table({
    Poseidon2_BN254: await hasher.getAddress(),
    WithdrawHonkVerifier: await withdrawVerifier.getAddress(),
    PayHonkVerifier: await payVerifier.getAddress(),
    PlaceOrderHonkVerifier: await placeOrderVerifier.getAddress(),
    CancelOrderHonkVerifier: await cancelOrderVerifier.getAddress(),
    MatchOrdersHonkVerifier: await matchOrdersVerifier.getAddress(),
    ShieldedVault: await vault.getAddress(),
    ComplianceRegistry: await compliance.getAddress(),
    StealthAnnouncer: await announcer.getAddress(),
    OwnerKeyRegistry: await ownerKeyRegistry.getAddress(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

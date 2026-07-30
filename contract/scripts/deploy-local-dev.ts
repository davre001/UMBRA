import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Stable local-dev deployment for frontend work against the running
 * `npx hardhat node` instance — not a throwaway test script. Deploys the
 * full contract set plus three MockERC20s standing in for WFLR/FXRP/USDT0
 * (assetId 0/1/2, same convention as deploy.ts's real Coston2 deploy), mints
 * a large balance to Hardhat's default account #0, and writes the addresses
 * to frontend/src/lib/noteWallet/localDevAddresses.json so the frontend can
 * pick them up without hand-copying.
 */
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

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying local dev stack with:", deployer.address);

  const Poseidon2 = await ethers.getContractFactory("Poseidon2_BN254");
  const hasher = await Poseidon2.deploy();
  await hasher.waitForDeployment();

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
    deployer.address
  );
  await vault.waitForDeployment();

  const Token = await ethers.getContractFactory("MockERC20");
  const assets = [
    { assetId: 0, symbol: "WFLR", name: "Mock Wrapped Flare" },
    { assetId: 1, symbol: "FXRP", name: "Mock FAssets XRP" },
    { assetId: 2, symbol: "USDT0", name: "Mock Tether USD" },
  ];
  const tokenAddresses: Record<string, string> = {};
  for (const { assetId, symbol, name } of assets) {
    const token = await Token.deploy(name, symbol);
    await token.waitForDeployment();
    await (await vault.setAsset(assetId, await token.getAddress(), true)).wait();
    await (await token.mint(deployer.address, ethers.parseEther("1000000"))).wait();
    tokenAddresses[symbol] = await token.getAddress();
    console.log(`${symbol} (assetId ${assetId}):`, await token.getAddress());
  }

  const Compliance = await ethers.getContractFactory("ComplianceRegistry");
  const compliance = await Compliance.deploy(deployer.address);
  await compliance.waitForDeployment();
  await (await vault.setComplianceRegistry(await compliance.getAddress())).wait();
  await (await compliance.grantRole(await compliance.ATTESTER_ROLE(), deployer.address)).wait();

  const OwnerKeyRegistry = await ethers.getContractFactory("OwnerKeyRegistry");
  const ownerKeyRegistry = await OwnerKeyRegistry.deploy();
  await ownerKeyRegistry.waitForDeployment();

  const out = {
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    vault: await vault.getAddress(),
    compliance: await compliance.getAddress(),
    ownerKeyRegistry: await ownerKeyRegistry.getAddress(),
    assets: {
      WFLR: { assetId: 0, token: tokenAddresses.WFLR, decimals: 18 },
      FXRP: { assetId: 1, token: tokenAddresses.FXRP, decimals: 18 },
      USDT0: { assetId: 2, token: tokenAddresses.USDT0, decimals: 18 },
    },
  };

  const outPath = path.join(__dirname, "../../frontend/src/lib/noteWallet/localDevAddresses.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log("\nWrote", outPath);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

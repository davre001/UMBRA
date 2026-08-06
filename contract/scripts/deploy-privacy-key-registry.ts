import { ethers } from "hardhat";

/**
 * Standalone deploy for PrivacyKeyRegistry — no constructor args, no wiring,
 * and no dependency on any other already-deployed contract. Safe to deploy
 * independently of the rest of the stack; nothing else needs to change or
 * redeploy alongside it. Same pattern as deploy-batch-withdrawer.ts.
 *
 * After deploying, paste the printed address into both
 * frontend/src/lib/noteWallet/coston2Addresses.json ("privacyKeyRegistry")
 * and backend/src/shared/coston2Deployment.json ("contracts.PrivacyKeyRegistry").
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const PrivacyKeyRegistry = await ethers.getContractFactory("PrivacyKeyRegistry");
  const registry = await PrivacyKeyRegistry.deploy();
  await registry.waitForDeployment();
  console.log("PrivacyKeyRegistry:", await registry.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

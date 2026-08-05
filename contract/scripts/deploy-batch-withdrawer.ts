import { ethers } from "hardhat";

/**
 * Standalone deploy for BatchWithdrawer — no constructor args, no wiring,
 * and no dependency on any other already-deployed contract (it takes the
 * vault address as a call-time parameter, not a constructor one). Safe to
 * deploy independently of the rest of the stack; nothing else needs to
 * change or redeploy alongside it.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const BatchWithdrawer = await ethers.getContractFactory("BatchWithdrawer");
  const batcher = await BatchWithdrawer.deploy();
  await batcher.waitForDeployment();
  console.log("BatchWithdrawer:", await batcher.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

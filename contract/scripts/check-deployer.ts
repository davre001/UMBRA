import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance (C2FLR):", ethers.formatEther(balance));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

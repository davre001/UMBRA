import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * One-off: allowlists the real Coston2 WFLR/FXRP/USDT0 addresses on an
 * already-deployed ShieldedVault (deploy.ts only allowlists assets passed
 * via env vars at deploy time). Addresses were confirmed live — WFLR via
 * FlareContractRegistry's WNat entry, FXRP via AssetManagerFXRP.fAsset(),
 * USDT0 by checking which faucet-issued token actually landed in the
 * deployer's wallet after claiming from https://faucet.flare.network/.
 */
async function main() {
  const deploymentPath = path.join(__dirname, "../deployments/coston2.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const assets: { assetId: number; symbol: string; address: string; decimals: number }[] = [
    { assetId: 0, symbol: "WFLR", address: "0xC67DCE33D7A8efA5FfEB961899C73fe01bCe9273", decimals: 18 },
    { assetId: 1, symbol: "FXRP", address: "0x0b6A3645c240605887a5532109323A3E12273dc7", decimals: 6 },
    { assetId: 2, symbol: "USDT0", address: "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F", decimals: 6 },
  ];

  const vault = await ethers.getContractAt("ShieldedVault", deployment.contracts.ShieldedVault);

  for (const { assetId, symbol, address } of assets) {
    const already = await vault.isAllowedAsset(assetId);
    if (already) {
      console.log(`assetId ${assetId} (${symbol}) already allowlisted, skipping`);
      continue;
    }
    await (await vault.setAsset(assetId, address, true)).wait();
    console.log(`Allowlisted assetId ${assetId} (${symbol}):`, address);
  }

  deployment.assets = {
    WFLR: { assetId: 0, token: assets[0].address, decimals: 18 },
    FXRP: { assetId: 1, token: assets[1].address, decimals: 6 },
    USDT0: { assetId: 2, token: assets[2].address, decimals: 6 },
  };
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2) + "\n");
  console.log("\nUpdated", deploymentPath);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

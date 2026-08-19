import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Two-step handoff of ShieldedVault's DEFAULT_ADMIN_ROLE from the deployer
 * EOA to the 2-of-3 Safe deployed by scripts/deploy-safe.ts. Split into two
 * separate, separately-run modes on purpose rather than one atomic
 * grant+renounce call — MODE=grant is cheap to verify and fully reversible
 * (the deployer still holds the role afterward, nothing lost if something
 * looks wrong); MODE=renounce is the actual point of no return (the
 * deployer gives up its own access permanently — from then on, ONLY the
 * Safe, via a real 2-of-3 execTransaction through
 * scripts/execute-safe-tx.ts, can ever call an admin-gated function on this
 * vault again, including re-granting the role to anything else). Running
 * them as separate steps means a mistake in step 1 (wrong Safe address,
 * Safe not actually working) is caught by MODE=grant's own on-chain
 * hasRole check before step 2 ever makes it irreversible.
 *
 *   MODE=grant    npx hardhat run scripts/transfer-admin-to-safe.ts --network coston2
 *   MODE=renounce npx hardhat run scripts/transfer-admin-to-safe.ts --network coston2
 *
 * MODE=renounce refuses to run at all unless the Safe already holds the
 * role (verified fresh from chain state, not assumed from a prior run) —
 * a safeguard against renouncing before the grant actually landed.
 */

function loadSafeDeployment(): { safeAddress: string } {
  const full = path.join(__dirname, "../deployments/coston2-safe.json");
  if (!fs.existsSync(full)) throw new Error(`${full} not found — run scripts/deploy-safe.ts first`);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

function loadVaultDeployment(): { contracts: { ShieldedVault: string } } {
  const full = path.join(__dirname, "../deployments/coston2.json");
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

async function main() {
  const mode = process.env.MODE;
  if (mode !== "grant" && mode !== "renounce") throw new Error('MODE must be "grant" or "renounce"');

  const { safeAddress } = loadSafeDeployment();
  const { contracts } = loadVaultDeployment();
  const vaultAddress = process.env.VAULT_ADDRESS ?? contracts.ShieldedVault;

  const [deployer] = await ethers.getSigners();
  const vault = await ethers.getContractAt("ShieldedVault", vaultAddress);
  const DEFAULT_ADMIN_ROLE = await vault.DEFAULT_ADMIN_ROLE();

  console.log("ShieldedVault:", vaultAddress);
  console.log("Safe:", safeAddress);
  console.log("Deployer:", deployer.address);

  const deployerHasRole: boolean = await vault.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
  const safeHasRole: boolean = await vault.hasRole(DEFAULT_ADMIN_ROLE, safeAddress);
  console.log("deployer currently holds DEFAULT_ADMIN_ROLE:", deployerHasRole);
  console.log("safe currently holds DEFAULT_ADMIN_ROLE:", safeHasRole);

  if (mode === "grant") {
    if (safeHasRole) {
      console.log("Safe already holds DEFAULT_ADMIN_ROLE — nothing to do.");
      return;
    }
    const tx = await vault.grantRole(DEFAULT_ADMIN_ROLE, safeAddress);
    const receipt = await tx.wait();
    console.log("grantRole confirmed:", receipt?.hash);
    const confirmed: boolean = await vault.hasRole(DEFAULT_ADMIN_ROLE, safeAddress);
    if (!confirmed) throw new Error("grantRole transaction succeeded but hasRole still reads false — investigate before proceeding to renounce");
    console.log("Verified: Safe now holds DEFAULT_ADMIN_ROLE. Deployer STILL also holds it — nothing is irreversible yet.");
    console.log("Next: confirm the Safe can actually act (e.g. a real admin call via scripts/execute-safe-tx.ts) before running MODE=renounce.");
    return;
  }

  // mode === "renounce"
  if (!safeHasRole) {
    throw new Error("Safe does not hold DEFAULT_ADMIN_ROLE yet — run MODE=grant first and verify it before renouncing the deployer's own access");
  }
  if (!deployerHasRole) {
    console.log("Deployer no longer holds DEFAULT_ADMIN_ROLE — nothing to do.");
    return;
  }
  const tx = await vault.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);
  const receipt = await tx.wait();
  console.log("renounceRole confirmed:", receipt?.hash);
  const stillHasRole: boolean = await vault.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
  console.log("deployer holds DEFAULT_ADMIN_ROLE now:", stillHasRole);
  console.log("\nDone. The Safe is now the ONLY DEFAULT_ADMIN_ROLE holder on this vault.");
  console.log("All future admin actions (queueSetTrustedVerifier, executeInitializeCheckpoint, etc.) must go through scripts/execute-safe-tx.ts.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

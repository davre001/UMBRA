import { ethers } from "hardhat";
import type { InterfaceAbi } from "ethers";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys a real, standalone 2-of-3 Safe (Gnosis Safe / Safe{Wallet}) to
 * Coston2 — the multisig that will hold ShieldedVault's DEFAULT_ADMIN_ROLE
 * (see scripts/transfer-admin-to-safe.ts for that separate, explicitly-
 * confirmed handoff step; this script only gets the Safe itself deployed
 * and verified).
 *
 * Coston2 isn't an officially Safe-supported chain (no indexed Transaction
 * Service, so app.safe.global and the API Kit's propose/track convenience
 * methods won't work here) — but the underlying contracts are chain-
 * agnostic Solidity, and Safe ships real, audited build artifacts
 * (ABI + bytecode) via the @safe-global/safe-contracts npm package.
 * Deliberately NOT using Safe's own deterministic CREATE2 singleton-factory
 * flow (which exists so a Safe lands at the identical address on every
 * chain) — that property only matters if you're relying on Safe's
 * cross-chain tooling/ecosystem recognizing the address, which none of
 * this repo's own tooling does anyway (see this script's own
 * scripts/execute-safe-tx.ts sibling for how we interact with it instead:
 * plain ABI calls against whatever address this script prints). A normal
 * deploy of the same real bytecode is simpler and has zero dependency on
 * Safe's factory being bootstrapped on Coston2 first.
 *
 * Owners: the existing deployer key (PRIVATE_KEY) plus two dedicated
 * throwaway Coston2 keys generated specifically for this (SAFE_OWNER_2_
 * and SAFE_OWNER_3_ vars in .env) — three separate keys so a single compromised
 * device can't unilaterally act, while still tolerating any one signer
 * being unavailable. Threshold 2.
 */

const SAFE_CONTRACTS_DIR = path.join(__dirname, "../node_modules/@safe-global/safe-contracts/build/artifacts/contracts");

function loadArtifact(relPath: string): { abi: InterfaceAbi; bytecode: string } {
  const full = path.join(SAFE_CONTRACTS_DIR, relPath);
  const json = JSON.parse(fs.readFileSync(full, "utf8"));
  return { abi: json.abi as InterfaceAbi, bytecode: json.bytecode as string };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const owner2 = process.env.SAFE_OWNER_2_ADDRESS;
  const owner3 = process.env.SAFE_OWNER_3_ADDRESS;
  if (!owner2 || !owner3) {
    throw new Error("SAFE_OWNER_2_ADDRESS / SAFE_OWNER_3_ADDRESS not set — see .env.example");
  }
  const owners = [deployer.address, owner2, owner3];
  const threshold = 2;
  console.log("Owners:", owners);
  console.log("Threshold:", threshold, "of", owners.length);

  const safeL2Artifact = loadArtifact("SafeL2.sol/SafeL2.json");
  const proxyFactoryArtifact = loadArtifact("proxies/SafeProxyFactory.sol/SafeProxyFactory.json");
  const fallbackHandlerArtifact = loadArtifact("handler/CompatibilityFallbackHandler.sol/CompatibilityFallbackHandler.json");

  async function deployRaw(name: string, artifact: { abi: InterfaceAbi; bytecode: string }) {
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
    const contract = await factory.deploy();
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`${name}:`, address);
    return contract;
  }

  const fallbackHandler = await deployRaw("CompatibilityFallbackHandler", fallbackHandlerArtifact);
  const safeSingleton = await deployRaw("SafeL2 (singleton)", safeL2Artifact);
  const proxyFactory = await deployRaw("SafeProxyFactory", proxyFactoryArtifact);

  const safeInterface = new ethers.Interface(safeL2Artifact.abi);
  const initializer = safeInterface.encodeFunctionData("setup", [
    owners,
    threshold,
    ethers.ZeroAddress, // to — no delegatecall during setup
    "0x", // data — no delegatecall payload
    await fallbackHandler.getAddress(),
    ethers.ZeroAddress, // paymentToken — no setup-payment refund
    0, // payment
    ethers.ZeroAddress, // paymentReceiver
  ]);

  const saltNonce = 0n; // fixed, readable — this script is meant to run once for this specific Safe
  console.log("Creating Safe proxy...");
  const tx = await (proxyFactory as unknown as { createProxyWithNonce: (a: string, b: string, c: bigint) => Promise<unknown> }).createProxyWithNonce(
    await safeSingleton.getAddress(),
    initializer,
    saltNonce
  );
  const receipt = await (tx as { wait: () => Promise<{ logs: { topics: string[]; data: string }[] }> }).wait();

  const proxyFactoryInterface = new ethers.Interface(proxyFactoryArtifact.abi);
  const creationLog = receipt.logs
    .map((log) => {
      try {
        return proxyFactoryInterface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.name === "ProxyCreation");
  if (!creationLog) throw new Error("ProxyCreation event not found in deployment receipt");
  const safeAddress: string = creationLog.args.proxy;
  console.log("Safe deployed at:", safeAddress);

  // Verify against the newly-deployed proxy directly (not just trusting our
  // own initializer encoding) — attach the Safe ABI to the proxy address
  // and read its real on-chain state back.
  const safe = new ethers.Contract(safeAddress, safeL2Artifact.abi, deployer);
  const onChainOwners: string[] = await safe.getOwners();
  const onChainThreshold: bigint = await safe.getThreshold();
  console.log("On-chain owners:", onChainOwners);
  console.log("On-chain threshold:", onChainThreshold.toString());
  if (onChainThreshold !== BigInt(threshold)) throw new Error("Threshold mismatch after setup — aborting before recording this deployment");
  for (const o of owners) {
    if (!onChainOwners.some((oo) => oo.toLowerCase() === o.toLowerCase())) {
      throw new Error(`Owner ${o} missing from on-chain owner set after setup — aborting before recording this deployment`);
    }
  }

  const out = {
    network: "coston2",
    chainId: 114,
    safeAddress,
    owners,
    threshold,
    contracts: {
      SafeL2: await safeSingleton.getAddress(),
      SafeProxyFactory: await proxyFactory.getAddress(),
      CompatibilityFallbackHandler: await fallbackHandler.getAddress(),
    },
    note:
      "Not deployed via Safe's deterministic CREATE2 singleton-factory (see this script's own header comment for why) — this Safe's address is specific to this deployment, not the same as a canonical cross-chain Safe address. app.safe.global will not recognize it (no Transaction Service indexing Coston2); interact via scripts/execute-safe-tx.ts instead.",
  };
  const outPath = path.join(__dirname, "../deployments/coston2-safe.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log("\nWrote", outPath);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

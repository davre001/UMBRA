import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * One-off cross-check: verifies a btc-deposit-worker-generated proof
 * (TypeScript/bb.js WASM proving) against the real on-chain
 * BtcDepositHonkVerifier — confirming the TS worker's independently
 * computed checkpoint_commitment/note_commitment/nullifier and proof are
 * byte-consistent with what the Noir circuit itself expects, not just
 * that the worker's own values match nargo test's. Not part of the
 * regular test suite (btc-deposit-worker/ is a separate package's output,
 * not something `contract/`'s own tests should depend on) — run manually:
 *   npx hardhat run scripts/verify-btc-deposit-proof.ts
 */
async function main() {
  const outputPath = path.join(__dirname, "../../btc-deposit-worker/onchain-check-output.json");
  const { proof, publicInputs } = JSON.parse(fs.readFileSync(outputPath, "utf8"));

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

  const verifier = await deployHonkVerifier("BtcDepositHonkVerifier", "BtcDepositRelationsLib", "BtcDepositZKTranscriptLib");
  console.log("BtcDepositHonkVerifier deployed:", await verifier.getAddress());
  console.log("proof length (bytes):", (proof.length - 2) / 2);
  console.log("publicInputs:", publicInputs);

  const result = await verifier.verify(proof, publicInputs);
  console.log("verify() result:", result);
  if (!result) {
    console.error("FAILED: proof did not verify on-chain");
    process.exitCode = 1;
  } else {
    console.log("SUCCESS: btc-deposit-worker's TypeScript-generated proof verifies on-chain.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Usage: CIRCUIT=withdraw CONTRACT=WithdrawHonkVerifier RELATIONS=WithdrawRelationsLib TRANSCRIPT=WithdrawZKTranscriptLib PUB_COUNT=5 hardhat run circuits/scripts/noir-onchain-verify.ts
async function main() {
  const circuit = process.env.CIRCUIT;
  const contractName = process.env.CONTRACT;
  const relationsName = process.env.RELATIONS;
  const transcriptName = process.env.TRANSCRIPT;
  const pubCount = Number(process.env.PUB_COUNT);
  if (!circuit || !contractName || !relationsName || !transcriptName || !pubCount) {
    throw new Error("Usage: CIRCUIT=... CONTRACT=... RELATIONS=... TRANSCRIPT=... PUB_COUNT=N hardhat run circuits/scripts/noir-onchain-verify.ts");
  }

  const target = path.join(__dirname, `../noir/${circuit}/target`);
  const proofBytes = "0x" + fs.readFileSync(path.join(target, "proof")).toString("hex");
  const publicInputsRaw = fs.readFileSync(path.join(target, "public_inputs"));
  if (publicInputsRaw.length !== pubCount * 32) {
    throw new Error(`Expected ${pubCount * 32} bytes of public inputs, got ${publicInputsRaw.length}`);
  }
  const publicInputs: string[] = [];
  for (let i = 0; i < pubCount; i++) {
    publicInputs.push("0x" + publicInputsRaw.subarray(i * 32, (i + 1) * 32).toString("hex"));
  }
  console.log("proof length (bytes):", (proofBytes.length - 2) / 2);
  console.log("publicInputs:", publicInputs);

  const Relations = await ethers.getContractFactory(relationsName);
  const relations = await Relations.deploy();
  await relations.waitForDeployment();

  const Transcript = await ethers.getContractFactory(transcriptName);
  const transcript = await Transcript.deploy();
  await transcript.waitForDeployment();

  const Verifier = await ethers.getContractFactory(contractName, {
    libraries: {
      [relationsName]: await relations.getAddress(),
      [transcriptName]: await transcript.getAddress(),
    },
  });
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();

  const ok = await verifier.verify(proofBytes, publicInputs);
  console.log(`[${circuit}] On-chain verify() with the real proof:`, ok);
  if (!ok) throw new Error("Real proof was rejected — pipeline is broken");

  const tampered = [...publicInputs];
  tampered[0] = ethers.zeroPadValue("0x01", 32);
  try {
    const rejected = await verifier.verify(proofBytes, tampered);
    console.log(`[${circuit}] tampered public input result:`, rejected, rejected ? "(BAD)" : "(correctly false)");
    if (rejected) throw new Error("Verifier accepted a tampered public input — broken");
  } catch (err: unknown) {
    console.log(`[${circuit}] tampered public input correctly reverted:`, (err as Error).message.split("\n")[0]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

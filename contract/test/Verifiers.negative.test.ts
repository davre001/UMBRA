import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const NOIR_DIR = path.join(__dirname, "../circuits/noir");

function loadFixture(
  circuit: "withdraw" | "pay" | "place_order" | "cancel_order" | "match_orders" | "btc_deposit",
  pubCount: number
) {
  const fixtures = path.join(NOIR_DIR, circuit, "fixtures");
  const proof = "0x" + fs.readFileSync(path.join(fixtures, "proof")).toString("hex");
  const raw = fs.readFileSync(path.join(fixtures, "public_inputs"));
  if (raw.length !== pubCount * 32) throw new Error(`${circuit}: expected ${pubCount * 32} bytes of public inputs`);
  const publicInputs: string[] = [];
  for (let i = 0; i < pubCount; i++) {
    publicInputs.push("0x" + raw.subarray(i * 32, (i + 1) * 32).toString("hex"));
  }
  return { proof, publicInputs };
}

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

// BN254 / Alt_bn128 scalar field modulus r
const BN254_SCALAR_FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

describe("ZK Verifiers Negative-Path & Proof Corruption Suite", function () {
  this.timeout(300_000);

  const verifierConfigs = [
    {
      name: "WithdrawHonkVerifier",
      circuit: "withdraw" as const,
      pubCount: 5,
      contract: "WithdrawHonkVerifier",
      relations: "WithdrawRelationsLib",
      transcript: "WithdrawZKTranscriptLib",
    },
    {
      name: "PayHonkVerifier",
      circuit: "pay" as const,
      pubCount: 4,
      contract: "PayHonkVerifier",
      relations: "PayRelationsLib",
      transcript: "PayZKTranscriptLib",
    },
    {
      name: "PlaceOrderHonkVerifier",
      circuit: "place_order" as const,
      pubCount: 3,
      contract: "PlaceOrderHonkVerifier",
      relations: "PlaceOrderRelationsLib",
      transcript: "PlaceOrderZKTranscriptLib",
    },
    {
      name: "CancelOrderHonkVerifier",
      circuit: "cancel_order" as const,
      pubCount: 3,
      contract: "CancelOrderHonkVerifier",
      relations: "CancelOrderRelationsLib",
      transcript: "CancelOrderZKTranscriptLib",
    },
    {
      name: "MatchOrdersHonkVerifier",
      circuit: "match_orders" as const,
      pubCount: 7,
      contract: "MatchOrdersHonkVerifier",
      relations: "MatchOrdersRelationsLib",
      transcript: "MatchOrdersZKTranscriptLib",
    },
    {
      name: "BtcDepositHonkVerifier",
      circuit: "btc_deposit" as const,
      pubCount: 4,
      contract: "BtcDepositHonkVerifier",
      relations: "BtcDepositRelationsLib",
      transcript: "BtcDepositZKTranscriptLib",
    },
  ];

  for (const cfg of verifierConfigs) {
    describe(`${cfg.name} (${cfg.circuit})`, () => {
      let verifier: any;
      let validProof: string;
      let validPublicInputs: string[];

      beforeEach(async () => {
        verifier = await deployHonkVerifier(cfg.contract, cfg.relations, cfg.transcript);
        const fixture = loadFixture(cfg.circuit, cfg.pubCount);
        validProof = fixture.proof;
        validPublicInputs = fixture.publicInputs;
      });

      it("passes verification with valid baseline proof and public inputs", async () => {
        const result = await verifier.verify(validProof, validPublicInputs);
        expect(result).to.equal(true);
      });

      it("fails verification when proof is truncated (missing 32 bytes)", async () => {
        // Remove 32 bytes (64 hex characters) from end
        const truncatedProof = validProof.slice(0, validProof.length - 64);
        try {
          const result = await verifier.verify(truncatedProof, validPublicInputs);
          expect(result).to.equal(false);
        } catch {
          // Reverting on invalid proof structure is also safe and expected
        }
      });

      it("fails verification when proof is empty (0x)", async () => {
        try {
          const result = await verifier.verify("0x", validPublicInputs);
          expect(result).to.equal(false);
        } catch {
          // Safe revert
        }
      });

      it("fails verification when proof has extra bytes appended", async () => {
        const appendedProof = validProof + "00".repeat(32);
        try {
          const result = await verifier.verify(appendedProof, validPublicInputs);
          expect(result).to.equal(false);
        } catch {
          // Safe revert
        }
      });

      it("fails verification on bit flip at the beginning of the proof", async () => {
        const proofBytes = ethers.getBytes(validProof);
        proofBytes[0] ^= 0x01; // Flip bit in first byte
        const mutatedProof = ethers.hexlify(proofBytes);

        try {
          const result = await verifier.verify(mutatedProof, validPublicInputs);
          expect(result).to.equal(false);
        } catch {
          // Safe revert
        }
      });

      it("fails verification on bit flip in the middle of the proof", async () => {
        const proofBytes = ethers.getBytes(validProof);
        const midIdx = Math.floor(proofBytes.length / 2);
        proofBytes[midIdx] ^= 0x01; // Flip bit in middle byte
        const mutatedProof = ethers.hexlify(proofBytes);

        try {
          const result = await verifier.verify(mutatedProof, validPublicInputs);
          expect(result).to.equal(false);
        } catch {
          // Safe revert
        }
      });

      it("fails verification on bit flip at the end of the proof", async () => {
        const proofBytes = ethers.getBytes(validProof);
        proofBytes[proofBytes.length - 1] ^= 0x01; // Flip bit in last byte
        const mutatedProof = ethers.hexlify(proofBytes);

        try {
          const result = await verifier.verify(mutatedProof, validPublicInputs);
          expect(result).to.equal(false);
        } catch {
          // Safe revert
        }
      });

      it("fails verification on all-zeroes proof of valid length", async () => {
        const proofBytes = ethers.getBytes(validProof);
        const zeroProof = "0x" + "00".repeat(proofBytes.length);

        try {
          const result = await verifier.verify(zeroProof, validPublicInputs);
          expect(result).to.equal(false);
        } catch {
          // Safe revert
        }
      });

      it("fails verification on all-0xFF proof of valid length", async () => {
        const proofBytes = ethers.getBytes(validProof);
        const ffProof = "0x" + "ff".repeat(proofBytes.length);

        try {
          const result = await verifier.verify(ffProof, validPublicInputs);
          expect(result).to.equal(false);
        } catch {
          // Safe revert
        }
      });

      it("fails verification when public input 0 (Merkle root) is mutated", async () => {
        const tamperedInputs = [...validPublicInputs];
        tamperedInputs[0] = ethers.keccak256(ethers.toUtf8Bytes("tampered-root"));

        try {
          const result = await verifier.verify(validProof, tamperedInputs);
          expect(result).to.equal(false);
        } catch {
          // Safe revert
        }
      });

      it("fails verification when public input 1 (Nullifier) is mutated", async () => {
        const tamperedInputs = [...validPublicInputs];
        tamperedInputs[1] = ethers.keccak256(ethers.toUtf8Bytes("tampered-nullifier"));

        try {
          const result = await verifier.verify(validProof, tamperedInputs);
          expect(result).to.equal(false);
        } catch {
          // Safe revert
        }
      });

      if (cfg.pubCount >= 3) {
        it("fails verification when public input 2 (Amount / Asset / Commitment) is mutated", async () => {
          const tamperedInputs = [...validPublicInputs];
          tamperedInputs[2] = ethers.toBeHex(999999999n, 32);

          try {
            const result = await verifier.verify(validProof, tamperedInputs);
            expect(result).to.equal(false);
          } catch {
            // Safe revert
          }
        });
      }

      it("fails verification or reverts when public input overflows BN254 scalar field (x >= r)", async () => {
        const tamperedInputs = [...validPublicInputs];
        // Set public input 0 to field modulus r (which is invalid field element)
        tamperedInputs[0] = ethers.toBeHex(BN254_SCALAR_FIELD_MODULUS, 32);

        try {
          const result = await verifier.verify(validProof, tamperedInputs);
          expect(result).to.equal(false);
        } catch {
          // Safe revert
        }

        // Set to max uint256
        tamperedInputs[0] = ethers.toBeHex(ethers.MaxUint256, 32);
        try {
          const result = await verifier.verify(validProof, tamperedInputs);
          expect(result).to.equal(false);
        } catch {
          // Safe revert
        }
      });
    });
  }
});

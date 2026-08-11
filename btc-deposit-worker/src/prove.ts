import { readFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { Noir } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import type { CompiledCircuit, InputMap } from "@noir-lang/types";
import { checkpointCommitment, depositNullifier } from "./poseidon2";
import type { BtcDepositProofInputs } from "./types";

/**
 * Real btc_deposit proving — same Noir/UltraHonk pipeline and same pinned
 * toolchain versions as matcher-worker/src/prove.ts (match_orders) and
 * frontend/src/lib/proving/prove.ts. Deliberately its own package, not
 * part of backend/ and not folded into matcher-worker/ — see this
 * package's README and BTC_DEPOSIT_DESIGN.md's "Proving location" section
 * for why btc_deposit needs its own worker (heavier than match_orders, and
 * no batching reason to share matcher-worker's EventBridge-scheduled
 * cadence).
 *
 * Reads the compiled circuit from ./circuit/btc_deposit.json — synced from
 * contract/circuits/noir/btc_deposit/target/ via `npm run sync-circuit`.
 */

const CIRCUIT_PATH = path.join(__dirname, "../circuit/btc_deposit.json");

let circuitPromise: Promise<CompiledCircuit> | null = null;
function loadCircuit(): Promise<CompiledCircuit> {
  if (!circuitPromise) {
    circuitPromise = readFile(CIRCUIT_PATH, "utf8").then((json) => JSON.parse(json) as CompiledCircuit);
  }
  return circuitPromise;
}

// btc_deposit's ~15,600 ACIR opcodes (see BTC_DEPOSIT_DESIGN.md's "Proving
// location" section) need more SRS/CRS points than @aztec/bb.js's WASM
// backend loads by default (2^19 = 524,288) — confirmed the hard way:
// proving failed with "prover trying to get too many points in
// MemBn254CrsFactory! 524288 vs 1048576" without this. match_orders and
// the browser circuits never hit this (all much smaller), so neither of
// this repo's other two prove.ts files needed it. Must be passed as
// `Barretenberg.new()`'s own `srsSize` option — calling `initSRSChonk`
// again afterward on an already-constructed instance does NOT reliably
// override the WASM module's already-initialized global CRS state
// (confirmed empirically: doing that still hit the exact same 524288-point
// error). Sized well above the observed requirement, not exactly to it, so
// a slightly larger future circuit revision doesn't silently reintroduce
// this failure.
const SRS_SIZE = 1 << 21; // 2,097,152 points

let apiPromise: Promise<Barretenberg> | null = null;
function getApi(): Promise<Barretenberg> {
  if (!apiPromise) apiPromise = Barretenberg.new({ srsSize: SRS_SIZE });
  return apiPromise;
}

function toHex(bytes: Uint8Array): `0x${string}` {
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}

/** [u8; N] / [[u8; N]; M] Noir inputs take one hex string per byte — confirmed against this exact compiled circuit before trusting it (not assumed from any spec), since neither of this repo's two existing prove.ts files had a byte-array precedent to copy. */
function byteArrayInput(bytesHex: string): string[] {
  const bytes = Buffer.from(bytesHex, "hex");
  return Array.from(bytes).map((b) => "0x" + b.toString(16).padStart(2, "0"));
}

function sha256d(buf: Buffer): Buffer {
  const h1 = createHash("sha256").update(buf).digest();
  return createHash("sha256").update(h1).digest();
}

export async function proveBtcDeposit(
  inputs: BtcDepositProofInputs
): Promise<{ proof: `0x${string}`; publicInputs: [string, string, string, string] }> {
  const checkpointHashBytes = Buffer.from(inputs.checkpointHash, "hex");
  const checkpointCommitmentValue = checkpointCommitment(checkpointHashBytes);

  const txBytes = Buffer.from(inputs.tx, "hex");
  const txid = sha256d(txBytes);
  const nullifierValue = depositNullifier(txid);

  // bitcoin.nr's `bytes_be_to_field` — the 20-byte recipient address
  // interpreted directly as a big-endian Field, same as any other
  // `[u8; N] -> Field` conversion in that circuit.
  const recipientValue = BigInt(inputs.recipient);
  const amountSats = BigInt(inputs.amountSats);

  const circuit = await loadCircuit();
  const noir = new Noir(circuit);

  const witnessInputs: InputMap = {
    checkpoint_commitment_pub: checkpointCommitmentValue.toString(),
    recipient: recipientValue.toString(),
    amount: amountSats.toString(),
    nullifier: nullifierValue.toString(),
    checkpoint_hash: byteArrayInput(inputs.checkpointHash),
    headers: inputs.headers.map(byteArrayInput),
    tx: byteArrayInput(inputs.tx),
    merkle_path_elements: inputs.merklePathElements.map(byteArrayInput),
    merkle_path_indices: inputs.merklePathIndices,
    merkle_actual_depth: inputs.merkleActualDepth.toString(),
  };

  const { witness } = await noir.execute(witnessInputs);

  const api = await getApi();
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  const { proof } = await backend.generateProof(witness, { verifierTarget: "evm" });

  return {
    proof: toHex(proof),
    publicInputs: [
      "0x" + checkpointCommitmentValue.toString(16).padStart(64, "0"),
      "0x" + recipientValue.toString(16).padStart(64, "0"),
      "0x" + amountSats.toString(16).padStart(64, "0"),
      "0x" + nullifierValue.toString(16).padStart(64, "0"),
    ],
  };
}

export async function destroyProver(): Promise<void> {
  if (apiPromise) {
    const api = await apiPromise;
    await api.destroy();
  }
}

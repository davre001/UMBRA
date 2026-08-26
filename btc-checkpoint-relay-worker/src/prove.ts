import { readFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { Noir } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import type { CompiledCircuit, InputMap } from "@noir-lang/types";
import { checkpointCommitment } from "./poseidon2";

/**
 * Real checkpoint_relay proving — same Noir/UltraHonk pipeline and same
 * pinned toolchain versions as btc-deposit-worker/src/prove.ts and
 * matcher-worker/src/prove.ts. Deliberately its own package (see this
 * package's own README) — different cadence from either of those.
 *
 * Reads the compiled circuit from ./circuit/checkpoint_relay.json — synced
 * from contract/circuits/noir/checkpoint_relay/target/ via `npm run
 * sync-circuit`.
 */

const CIRCUIT_PATH = path.join(__dirname, "../circuit/checkpoint_relay.json");

let circuitPromise: Promise<CompiledCircuit> | null = null;
function loadCircuit(): Promise<CompiledCircuit> {
  if (!circuitPromise) {
    circuitPromise = readFile(CIRCUIT_PATH, "utf8").then((json) => JSON.parse(json) as CompiledCircuit);
  }
  return circuitPromise;
}

// checkpoint_relay is a single K=6 header-chain check (no tx/Merkle parsing
// on top, unlike btc_deposit) — well under the default WASM CRS point
// count, so no srsSize override needed here (contrast
// btc-deposit-worker/src/prove.ts's own SRS_SIZE comment).
let apiPromise: Promise<Barretenberg> | null = null;
function getApi(): Promise<Barretenberg> {
  if (!apiPromise) apiPromise = Barretenberg.new({});
  return apiPromise;
}

function toHex(bytes: Uint8Array): `0x${string}` {
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}

/** [u8; N] / [[u8; N]; M] Noir inputs take one hex string per byte — same convention btc-deposit-worker/src/prove.ts's own byteArrayInput confirmed against a real compiled circuit. */
function byteArrayInput(bytesHex: string): string[] {
  const bytes = Buffer.from(bytesHex, "hex");
  return Array.from(bytes).map((b) => "0x" + b.toString(16).padStart(2, "0"));
}

export interface CheckpointRelayProofInputs {
  checkpointHashHex: string;
  headersHex: string[];
}

export async function proveCheckpointExtension(
  inputs: CheckpointRelayProofInputs
): Promise<{ proof: `0x${string}`; oldCommitment: `0x${string}`; newCommitment: `0x${string}` }> {
  const oldHashBytes = Buffer.from(inputs.checkpointHashHex, "hex");
  const oldCommitmentValue = checkpointCommitment(oldHashBytes);

  // Mirrors bitcoin_headers.nr's verify_header_chain: the tip is the last
  // header's own sha256d hash — recomputed here (not re-derived from the
  // circuit) purely to know what to label new_checkpoint_commitment_pub
  // before proving; the circuit independently recomputes and checks the
  // exact same value from the same header bytes.
  function sha256d(buf: Buffer): Buffer {
    const h1 = createHash("sha256").update(buf).digest();
    return createHash("sha256").update(h1).digest();
  }
  const tipHeaderBytes = Buffer.from(inputs.headersHex[inputs.headersHex.length - 1], "hex");
  const tipHash = sha256d(tipHeaderBytes);
  const newCommitmentValue = checkpointCommitment(tipHash);

  const circuit = await loadCircuit();
  const noir = new Noir(circuit);

  const witnessInputs: InputMap = {
    old_checkpoint_commitment_pub: oldCommitmentValue.toString(),
    new_checkpoint_commitment_pub: newCommitmentValue.toString(),
    old_checkpoint_hash: byteArrayInput(inputs.checkpointHashHex),
    headers: inputs.headersHex.map(byteArrayInput),
  };

  const { witness } = await noir.execute(witnessInputs);

  const api = await getApi();
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  const { proof } = await backend.generateProof(witness, { verifierTarget: "evm" });

  return {
    proof: toHex(proof),
    oldCommitment: ("0x" + oldCommitmentValue.toString(16).padStart(64, "0")) as `0x${string}`,
    newCommitment: ("0x" + newCommitmentValue.toString(16).padStart(64, "0")) as `0x${string}`,
  };
}

export async function destroyProver(): Promise<void> {
  if (apiPromise) {
    const api = await apiPromise;
    await api.destroy();
  }
}

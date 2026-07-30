import { readFile } from "fs/promises";
import path from "path";
import { Noir } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import type { CompiledCircuit } from "@noir-lang/types";
import type { MatchProofInputs } from "./types";

/**
 * Real match_orders proving — same Noir/UltraHonk pipeline and same pinned
 * toolchain versions as frontend/src/lib/proving/prove.ts. Deliberately its
 * own package, not part of backend/, so `@aztec/bb.js` and its WASM/CRS
 * footprint never ships to the constrained Render deployment — see this
 * package's README.
 *
 * Reads the compiled circuit from ./circuit/match_orders.json — a local
 * copy synced from contract/circuits/noir/match_orders/target/ via `npm run
 * sync-circuit` (see package.json), not a monorepo-relative reach-across.
 * This package needs to be a self-contained build artifact (a Docker image
 * for AWS Lambda — see README) that doesn't assume contract/ is a sibling
 * directory at runtime the way it is in this monorepo's checkout.
 */

const CIRCUIT_PATH = path.join(__dirname, "../circuit/match_orders.json");

let circuitPromise: Promise<CompiledCircuit> | null = null;
function loadCircuit(): Promise<CompiledCircuit> {
  if (!circuitPromise) {
    circuitPromise = readFile(CIRCUIT_PATH, "utf8").then((json) => JSON.parse(json) as CompiledCircuit);
  }
  return circuitPromise;
}

let apiPromise: Promise<Barretenberg> | null = null;
function getApi(): Promise<Barretenberg> {
  if (!apiPromise) apiPromise = Barretenberg.new();
  return apiPromise;
}

function toHex(bytes: Uint8Array): `0x${string}` {
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}

function fieldsOf(values: bigint[]): string[] {
  return values.map((v) => v.toString());
}

export async function proveMatchOrders(inputs: MatchProofInputs): Promise<`0x${string}`> {
  const side = (s: MatchProofInputs["a"], prefix: "a" | "b") => ({
    [`${prefix}_spending_key`]: s.spendingKey.toString(),
    [`${prefix}_order_blinding`]: s.orderBlinding.toString(),
    [`${prefix}_amount_in`]: s.amountIn.toString(),
    [`${prefix}_asset_in`]: s.assetIn.toString(),
    [`${prefix}_asset_out`]: s.assetOut.toString(),
    [`${prefix}_min_amount_out`]: s.minAmountOut.toString(),
    [`${prefix}_path_elements`]: fieldsOf(s.pathElements),
    [`${prefix}_path_indices`]: s.pathIndices,
    [`${prefix}_out_blinding`]: s.outBlinding.toString(),
    [`${prefix}_residual_blinding`]: s.residualBlinding.toString(),
  });

  const circuit = await loadCircuit();
  const noir = new Noir(circuit);
  const { witness } = await noir.execute({
    root: inputs.root.toString(),
    nullifier_hash_a: inputs.nullifierHashA.toString(),
    nullifier_hash_b: inputs.nullifierHashB.toString(),
    out_commitment_a: inputs.outCommitmentA.toString(),
    out_commitment_b: inputs.outCommitmentB.toString(),
    residual_commitment_a: inputs.residualCommitmentA.toString(),
    residual_commitment_b: inputs.residualCommitmentB.toString(),
    fill_a: inputs.fillA.toString(),
    fill_b: inputs.fillB.toString(),
    ...side(inputs.a, "a"),
    ...side(inputs.b, "b"),
  });

  const api = await getApi();
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  const { proof } = await backend.generateProof(witness, { verifierTarget: "evm" });
  return toHex(proof);
}

export async function destroyProver(): Promise<void> {
  if (apiPromise) {
    const api = await apiPromise;
    await api.destroy();
  }
}

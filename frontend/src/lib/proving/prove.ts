import { Noir } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import type { CompiledCircuit, InputMap } from "@noir-lang/types";

/**
 * Real in-browser proving for the 5 Umbra circuits — Noir (witness
 * generation) + Barretenberg/UltraHonk (proof generation), matching exactly
 * what `bb prove -t evm` produces server-side (see circuits/README.md):
 * same noir_version/bb version as the installed toolchain, same
 * `verifierTarget: 'evm'` (keccak-based, ZK) proof shape the deployed
 * Verifier.sol contracts expect via `verify(bytes proof, bytes32[]
 * publicInputs)`. The contract computes `publicInputs` itself from its own
 * typed calldata args — only the raw proof bytes need to be submitted.
 */

export type CircuitName = "withdraw" | "pay" | "place_order" | "cancel_order";

const circuitCache = new Map<CircuitName, Promise<CompiledCircuit>>();

function loadCircuit(name: CircuitName): Promise<CompiledCircuit> {
  let promise = circuitCache.get(name);
  if (!promise) {
    promise = fetch(`/circuits/${name}.json`).then((res) => {
      if (!res.ok) throw new Error(`Failed to load circuit artifact for ${name} (${res.status})`);
      return res.json() as Promise<CompiledCircuit>;
    });
    circuitCache.set(name, promise);
  }
  return promise;
}

let apiPromise: Promise<Barretenberg> | null = null;

/** Shared Barretenberg WASM instance — expensive to init, reused across every proof in the session. */
function getApi(): Promise<Barretenberg> {
  if (!apiPromise) apiPromise = Barretenberg.new();
  return apiPromise;
}

/** Runs witness generation + UltraHonk proving for one circuit. Returns the raw split proof (public inputs stripped, matching `fixtures/proof`) and the public inputs bb.js derived, as decimal-string fields — useful for local sanity checks, not required on-chain (the contract reconstructs them from its own typed args). */
export async function proveCircuit(
  name: CircuitName,
  inputs: InputMap
): Promise<{ proof: Uint8Array; publicInputs: string[] }> {
  const circuit = await loadCircuit(name);
  const noir = new Noir(circuit);
  const { witness } = await noir.execute(inputs);

  const api = await getApi();
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  return backend.generateProof(witness, { verifierTarget: "evm" });
}

function toHex(bytes: Uint8Array): `0x${string}` {
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}

function fieldsOf(values: bigint[]): string[] {
  return values.map((v) => v.toString());
}

export interface MerkleProofInput {
  pathElements: bigint[];
  pathIndices: boolean[];
}

/** Proves ownership of the input note being spent — same private-input shape for withdraw/pay/place_order's spent note. */
interface SpentNoteInput {
  spendingKey: bigint;
  blinding: bigint;
  merklePath: MerkleProofInput;
}

export async function proveWithdraw(params: {
  root: bigint;
  nullifierHash: bigint;
  amount: bigint;
  assetId: bigint;
  recipient: bigint;
  note: SpentNoteInput;
}): Promise<`0x${string}`> {
  const { proof } = await proveCircuit("withdraw", {
    root: params.root.toString(),
    nullifier_hash_pub: params.nullifierHash.toString(),
    amount: params.amount.toString(),
    asset_id: params.assetId.toString(),
    recipient: params.recipient.toString(),
    spending_key: params.note.spendingKey.toString(),
    blinding: params.note.blinding.toString(),
    path_elements: fieldsOf(params.note.merklePath.pathElements),
    path_indices: params.note.merklePath.pathIndices,
  });
  return toHex(proof);
}

export async function provePay(params: {
  root: bigint;
  nullifierHash: bigint;
  amount: bigint;
  assetId: bigint;
  outCommitment: bigint;
  outOwnerKey: bigint;
  outBlinding: bigint;
  note: SpentNoteInput;
}): Promise<`0x${string}`> {
  const { proof } = await proveCircuit("pay", {
    root: params.root.toString(),
    nullifier_hash_pub: params.nullifierHash.toString(),
    asset_id: params.assetId.toString(),
    out_commitment: params.outCommitment.toString(),
    spending_key: params.note.spendingKey.toString(),
    blinding: params.note.blinding.toString(),
    amount: params.amount.toString(),
    path_elements: fieldsOf(params.note.merklePath.pathElements),
    path_indices: params.note.merklePath.pathIndices,
    out_owner_key: params.outOwnerKey.toString(),
    out_blinding: params.outBlinding.toString(),
  });
  return toHex(proof);
}

export async function provePlaceOrder(params: {
  root: bigint;
  nullifierHash: bigint;
  orderCommitment: bigint;
  amountIn: bigint;
  assetIn: bigint;
  note: SpentNoteInput;
  orderBlinding: bigint;
  assetOut: bigint;
  minAmountOut: bigint;
}): Promise<`0x${string}`> {
  const { proof } = await proveCircuit("place_order", {
    root: params.root.toString(),
    nullifier_hash_pub: params.nullifierHash.toString(),
    order_commitment_pub: params.orderCommitment.toString(),
    spending_key: params.note.spendingKey.toString(),
    blinding: params.note.blinding.toString(),
    amount_in: params.amountIn.toString(),
    asset_in: params.assetIn.toString(),
    path_elements: fieldsOf(params.note.merklePath.pathElements),
    path_indices: params.note.merklePath.pathIndices,
    order_blinding: params.orderBlinding.toString(),
    asset_out: params.assetOut.toString(),
    min_amount_out: params.minAmountOut.toString(),
  });
  return toHex(proof);
}

export async function proveCancelOrder(params: {
  root: bigint;
  nullifierHash: bigint;
  refundCommitment: bigint;
  spendingKey: bigint;
  orderBlinding: bigint;
  amountIn: bigint;
  assetIn: bigint;
  assetOut: bigint;
  minAmountOut: bigint;
  merklePath: MerkleProofInput;
  refundBlinding: bigint;
}): Promise<`0x${string}`> {
  const { proof } = await proveCircuit("cancel_order", {
    root: params.root.toString(),
    nullifier_hash_pub: params.nullifierHash.toString(),
    refund_commitment_pub: params.refundCommitment.toString(),
    spending_key: params.spendingKey.toString(),
    order_blinding: params.orderBlinding.toString(),
    amount_in: params.amountIn.toString(),
    asset_in: params.assetIn.toString(),
    asset_out: params.assetOut.toString(),
    min_amount_out: params.minAmountOut.toString(),
    path_elements: fieldsOf(params.merklePath.pathElements),
    path_indices: params.merklePath.pathIndices,
    refund_blinding: params.refundBlinding.toString(),
  });
  return toHex(proof);
}

// match_orders proving happens in matcher-worker/ (a separate package, kept
// off this constrained deployment's dependency tree — see that package's
// own prove.ts), never in the browser, so there's no proveMatchOrders here.

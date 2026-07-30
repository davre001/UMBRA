import { randomBytes } from "crypto";
import { commitment as computeCommitment, nullifierHash as computeNullifierHash } from "../shared/poseidon2";
import { MerkleTree } from "../shared/merkleTree";
import { fetchAllLeaves } from "../shared/scan";
import type { OrderIntent, MatchProofInputs, MatchOrderSide } from "./types";

const FIELD_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

function randomBlinding(): bigint {
  let value = BigInt(0);
  for (const b of randomBytes(31)) value = (value << BigInt(8)) | BigInt(b);
  return value % FIELD_PRIME;
}

/**
 * Real commitment/public-input assembly — the same Poseidon2 math the
 * on-chain verifier will check, and the same Merkle-path logic the frontend
 * uses (shared/merkleTree.ts, shared/scan.ts). This is genuinely testable
 * against the circuit's own fixture without touching the chain or doing any
 * proving — see dark-engine's test file for that cross-check.
 */
export async function assembleMatchProofInputs(
  vaultAddress: `0x${string}`,
  orderA: OrderIntent,
  orderB: OrderIntent
): Promise<MatchProofInputs> {
  const leaves = await fetchAllLeaves(vaultAddress);
  const asOfIndex = Math.max(orderA.leafIndex, orderB.leafIndex);
  const tree = new MerkleTree(leaves, asOfIndex);
  const pathA = tree.path(orderA.leafIndex);
  const pathB = tree.path(orderB.leafIndex);

  const nullifierHashA = computeNullifierHash(BigInt(orderA.commitment), BigInt(orderA.nullifier));
  const nullifierHashB = computeNullifierHash(BigInt(orderB.commitment), BigInt(orderB.nullifier));

  const aOutBlinding = randomBlinding();
  const bOutBlinding = randomBlinding();
  const outCommitmentA = computeCommitment(BigInt(orderB.assetIn), BigInt(orderB.amountIn), BigInt(orderA.ownerKey), aOutBlinding);
  const outCommitmentB = computeCommitment(BigInt(orderA.assetIn), BigInt(orderA.amountIn), BigInt(orderB.ownerKey), bOutBlinding);

  const side = (order: OrderIntent, outBlinding: bigint, path: { pathElements: bigint[]; pathIndices: boolean[] }): MatchOrderSide => ({
    secret: BigInt(order.secret),
    nullifier: BigInt(order.nullifier),
    amountIn: BigInt(order.amountIn),
    assetIn: BigInt(order.assetIn),
    assetOut: BigInt(order.assetOut),
    minAmountOut: BigInt(order.minAmountOut),
    pathElements: path.pathElements,
    pathIndices: path.pathIndices,
    outOwnerKey: BigInt(order.ownerKey),
    outBlinding,
  });

  return {
    root: tree.root,
    nullifierHashA,
    nullifierHashB,
    outCommitmentA,
    outCommitmentB,
    a: side(orderA, aOutBlinding, pathA),
    b: side(orderB, bOutBlinding, pathB),
  };
}

export interface MatchProver {
  proveMatch(inputs: MatchProofInputs): Promise<`0x${string}`>;
}

/**
 * Default prover for this deployment. Real `match_orders` proving needs
 * bb.js + the compiled circuit, which this backend deliberately does not
 * run (constrained hosting — see backend/README or session notes). Matches
 * are still assembled for real (public inputs above are correct and
 * verifier-checkable); they just sit as `awaiting_proof` until a real
 * `MatchProver` is wired in — e.g. a separate worker with proving capacity,
 * polling `GET /api/dark-engine/matches?status=awaiting_proof`.
 */
export class UnavailableMatchProver implements MatchProver {
  async proveMatch(): Promise<`0x${string}`> {
    throw new Error(
      "No match_orders prover configured for this deployment — proving needs bb.js, which this backend doesn't run. Wire a real MatchProver to complete on-chain matching."
    );
  }
}

import { randomBytes } from "crypto";
import { commitment as computeCommitment, nullifierHash as computeNullifierHash, orderCommitment as computeOrderCommitment } from "../shared/poseidon2";
import { MerkleTree, ZERO_VALUE } from "../shared/merkleTree";
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
 * uses (shared/merkleTree.ts, shared/scan.ts). `fillA`/`fillB` come from
 * fillSizing.ts's `computeFill` (already validated against both sides'
 * pro-rata minimums with exact integer arithmetic) — this function only
 * turns a decided fill into the actual notes/residuals match_orders needs,
 * it doesn't decide the fill itself.
 */
export async function assembleMatchProofInputs(
  vaultAddress: `0x${string}`,
  orderA: OrderIntent,
  orderB: OrderIntent,
  fillA: bigint,
  fillB: bigint
): Promise<MatchProofInputs> {
  const leaves = await fetchAllLeaves(vaultAddress);
  const asOfIndex = Math.max(orderA.leafIndex, orderB.leafIndex);
  const tree = new MerkleTree(leaves, asOfIndex);
  const pathA = tree.path(orderA.leafIndex);
  const pathB = tree.path(orderB.leafIndex);

  const nullifierHashA = computeNullifierHash(BigInt(orderA.commitment), BigInt(orderA.spendingKey));
  const nullifierHashB = computeNullifierHash(BigInt(orderB.commitment), BigInt(orderB.spendingKey));

  const aOutBlinding = randomBlinding();
  const bOutBlinding = randomBlinding();
  // A receives fillB of B's asset; B receives fillA of A's asset.
  const outCommitmentA = computeCommitment(BigInt(orderB.assetIn), fillB, BigInt(orderA.ownerKey), aOutBlinding);
  const outCommitmentB = computeCommitment(BigInt(orderA.assetIn), fillA, BigInt(orderB.ownerKey), bOutBlinding);

  const aAmountIn = BigInt(orderA.amountIn);
  const bAmountIn = BigInt(orderB.amountIn);
  const aResidualBlinding = randomBlinding();
  const bResidualBlinding = randomBlinding();

  const aResidualAmount = aAmountIn - fillA;
  const aResidual =
    aResidualAmount > BigInt(0)
      ? {
          amountIn: aResidualAmount,
          minAmountOut: (aResidualAmount * BigInt(orderA.minAmountOut)) / aAmountIn,
          commitment: BigInt(0), // filled in below
        }
      : undefined;
  const residualCommitmentA = aResidual
    ? computeOrderCommitment(BigInt(orderA.ownerKey), aResidualBlinding, aResidual.amountIn, BigInt(orderA.assetIn), BigInt(orderA.assetOut), aResidual.minAmountOut)
    : ZERO_VALUE;
  if (aResidual) aResidual.commitment = residualCommitmentA;

  const bResidualAmount = bAmountIn - fillB;
  const bResidual =
    bResidualAmount > BigInt(0)
      ? {
          amountIn: bResidualAmount,
          minAmountOut: (bResidualAmount * BigInt(orderB.minAmountOut)) / bAmountIn,
          commitment: BigInt(0),
        }
      : undefined;
  const residualCommitmentB = bResidual
    ? computeOrderCommitment(BigInt(orderB.ownerKey), bResidualBlinding, bResidual.amountIn, BigInt(orderB.assetIn), BigInt(orderB.assetOut), bResidual.minAmountOut)
    : ZERO_VALUE;
  if (bResidual) bResidual.commitment = residualCommitmentB;

  const side = (
    order: OrderIntent,
    outBlinding: bigint,
    residualBlinding: bigint,
    residual: { amountIn: bigint; minAmountOut: bigint; commitment: bigint } | undefined,
    path: { pathElements: bigint[]; pathIndices: boolean[] }
  ): MatchOrderSide => ({
    spendingKey: BigInt(order.spendingKey),
    orderBlinding: BigInt(order.orderBlinding),
    amountIn: BigInt(order.amountIn),
    assetIn: BigInt(order.assetIn),
    assetOut: BigInt(order.assetOut),
    minAmountOut: BigInt(order.minAmountOut),
    pathElements: path.pathElements,
    pathIndices: path.pathIndices,
    outBlinding,
    residualBlinding,
    residual,
  });

  return {
    root: tree.root,
    nullifierHashA,
    nullifierHashB,
    outCommitmentA,
    outCommitmentB,
    residualCommitmentA,
    residualCommitmentB,
    fillA,
    fillB,
    a: side(orderA, aOutBlinding, aResidualBlinding, aResidual, pathA),
    b: side(orderB, bOutBlinding, bResidualBlinding, bResidual, pathB),
  };
}

export interface MatchProver {
  proveMatch(inputs: MatchProofInputs): Promise<`0x${string}`>;
}

/** Thrown only by UnavailableMatchProver — lets callers distinguish "no prover wired in yet" (expected on this deployment) from a real failure elsewhere in completeMatch (e.g. submitMatch's on-chain revert), which should not be logged as if it were equally routine. */
export class NoProverConfiguredError extends Error {}

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
    throw new NoProverConfiguredError(
      "No match_orders prover configured for this deployment — proving needs bb.js, which this backend doesn't run. Wire a real MatchProver to complete on-chain matching."
    );
  }
}

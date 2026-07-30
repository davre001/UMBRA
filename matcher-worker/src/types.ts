// Mirrors backend/src/dark-engine/types.ts's MatchProofInputs — kept as a
// separate copy since this package has no dependency on backend/'s source.

export interface MatchOrderSide {
  spendingKey: bigint;
  orderBlinding: bigint;
  amountIn: bigint;
  assetIn: bigint;
  assetOut: bigint;
  minAmountOut: bigint;
  pathElements: bigint[];
  pathIndices: boolean[];
  outBlinding: bigint;
  residualBlinding: bigint;
}

export interface MatchProofInputs {
  root: bigint;
  nullifierHashA: bigint;
  nullifierHashB: bigint;
  outCommitmentA: bigint;
  outCommitmentB: bigint;
  residualCommitmentA: bigint;
  residualCommitmentB: bigint;
  fillA: bigint;
  fillB: bigint;
  a: MatchOrderSide;
  b: MatchOrderSide;
}

/** Recursively converts the decimal-string bigints the backend serializes with into real bigints, and numeric path_indices (0/1) into booleans if needed. */
export function deserializeMatchProofInputs(raw: unknown): MatchProofInputs {
  const obj = raw as Record<string, unknown>;
  const side = (s: Record<string, unknown>): MatchOrderSide => ({
    spendingKey: BigInt(s.spendingKey as string),
    orderBlinding: BigInt(s.orderBlinding as string),
    amountIn: BigInt(s.amountIn as string),
    assetIn: BigInt(s.assetIn as string),
    assetOut: BigInt(s.assetOut as string),
    minAmountOut: BigInt(s.minAmountOut as string),
    pathElements: (s.pathElements as string[]).map((v) => BigInt(v)),
    pathIndices: s.pathIndices as boolean[],
    outBlinding: BigInt(s.outBlinding as string),
    residualBlinding: BigInt(s.residualBlinding as string),
  });
  return {
    root: BigInt(obj.root as string),
    nullifierHashA: BigInt(obj.nullifierHashA as string),
    nullifierHashB: BigInt(obj.nullifierHashB as string),
    outCommitmentA: BigInt(obj.outCommitmentA as string),
    outCommitmentB: BigInt(obj.outCommitmentB as string),
    residualCommitmentA: BigInt(obj.residualCommitmentA as string),
    residualCommitmentB: BigInt(obj.residualCommitmentB as string),
    fillA: BigInt(obj.fillA as string),
    fillB: BigInt(obj.fillB as string),
    a: side(obj.a as Record<string, unknown>),
    b: side(obj.b as Record<string, unknown>),
  };
}

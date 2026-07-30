import { poseidon2Hash } from "@zkpassport/poseidon2";

// Matches contract/circuits/noir/lib/src/lib.nr exactly — verified against
// real Noir-computed reference values for every arity used here (2, 4, 6
// inputs) before being trusted, not assumed compatible just because both
// are called "Poseidon2". See the umbra memory / session notes for the
// verification values if this ever needs re-checking.

export function hashLeftRight(left: bigint, right: bigint): bigint {
  return poseidon2Hash([left, right]);
}

/** Public identifier derived from a wallet's private spending key — safe to publish (e.g. via OwnerKeyRegistry). */
export function ownerKey(spendingKey: bigint): bigint {
  return hashLeftRight(spendingKey, BigInt(0));
}

export function commitment(assetId: bigint, amount: bigint, ownerKeyValue: bigint, blinding: bigint): bigint {
  return poseidon2Hash([assetId, amount, ownerKeyValue, blinding]);
}

/** Only whoever holds `spendingKey` (the preimage of the note's ownerKey) can compute this. */
export function nullifierHash(noteCommitment: bigint, spendingKey: bigint): bigint {
  return hashLeftRight(noteCommitment, spendingKey);
}

export function orderCommitment(
  nullifier: bigint,
  secret: bigint,
  amountIn: bigint,
  assetIn: bigint,
  assetOut: bigint,
  minAmountOut: bigint
): bigint {
  return poseidon2Hash([nullifier, secret, amountIn, assetIn, assetOut, minAmountOut]);
}

import { poseidon2Hash } from "@zkpassport/poseidon2";

// Mirrors contract/circuits/noir/lib/src/lib.nr and
// frontend/src/lib/noteWallet/poseidon2.ts exactly — same library, same
// version, so no separate re-verification needed here.

export function hashLeftRight(left: bigint, right: bigint): bigint {
  return poseidon2Hash([left, right]);
}

export function ownerKey(spendingKey: bigint): bigint {
  return hashLeftRight(spendingKey, BigInt(0));
}

export function commitment(assetId: bigint, amount: bigint, ownerKeyValue: bigint, blinding: bigint): bigint {
  return poseidon2Hash([assetId, amount, ownerKeyValue, blinding]);
}

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

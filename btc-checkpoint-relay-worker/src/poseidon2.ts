import { poseidon2Hash } from "@zkpassport/poseidon2";

// Mirrors backend/src/shared/poseidon2.ts, btc-deposit-worker/src/poseidon2.ts,
// and contract/circuits/noir/checkpoint_relay/src/bitcoin_headers.nr exactly
// — same library, same version. Reimplemented locally (not imported from
// btc-deposit-worker/ or backend/) for the same reason those packages don't
// reach across to each other either: this package is meant to be a
// self-contained deployment artifact.

export function hashLeftRight(left: bigint, right: bigint): bigint {
  return poseidon2Hash([left, right]);
}

/** Splits a 32-byte Buffer (native/little-endian order, matching bitcoin_headers.nr's own byte order throughout) into (lo, hi) 128-bit limbs — same split contract/circuits/noir/checkpoint_relay/src/bitcoin_headers.nr's `bytes32_to_u128_limbs` performs, needed for the exact same reason: BN254's field can't safely hold an arbitrary 256-bit value. */
export function bytes32ToLimbs(bytes: Buffer): { lo: bigint; hi: bigint } {
  if (bytes.length !== 32) throw new Error(`expected 32 bytes, got ${bytes.length}`);
  let lo = 0n;
  let mul = 1n;
  for (let i = 0; i < 16; i++) {
    lo += BigInt(bytes[i]) * mul;
    mul *= 256n;
  }
  let hi = 0n;
  mul = 1n;
  for (let i = 16; i < 32; i++) {
    hi += BigInt(bytes[i]) * mul;
    mul *= 256n;
  }
  return { lo, hi };
}

/** bitcoin_headers.nr's `checkpoint_commitment`: Poseidon2 over a 32-byte hash's own (lo, hi) limbs. */
export function checkpointCommitment(checkpointHash: Buffer): bigint {
  const { lo, hi } = bytes32ToLimbs(checkpointHash);
  return hashLeftRight(lo, hi);
}

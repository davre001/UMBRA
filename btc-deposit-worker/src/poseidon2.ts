import { poseidon2Hash } from "@zkpassport/poseidon2";

// Mirrors backend/src/shared/poseidon2.ts and contract/circuits/noir/lib/
// src/lib.nr exactly — same library, same version. Reimplemented locally
// (not imported from backend/) for the same reason matcher-worker doesn't
// reach across to backend/ either: this package is meant to be a
// self-contained deployment artifact.

export function hashLeftRight(left: bigint, right: bigint): bigint {
  return poseidon2Hash([left, right]);
}

/** Splits a 32-byte Buffer (native/little-endian order, matching bitcoin.nr's own byte order throughout) into (lo, hi) 128-bit limbs — same split contract/circuits/noir/btc_deposit/src/bitcoin.nr's `bytes32_to_u128_limbs` performs, needed for the exact same reason: BN254's field can't safely hold an arbitrary 256-bit value. */
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

/** bitcoin.nr's `checkpoint_commitment`: Poseidon2 over a 32-byte hash's own (lo, hi) limbs. */
export function checkpointCommitment(checkpointHash: Buffer): bigint {
  const { lo, hi } = bytes32ToLimbs(checkpointHash);
  return hashLeftRight(lo, hi);
}

// keccak256("BTC_SIGNET") % Fr (BN254 scalar field) — same constant
// contract/circuits/noir/btc_deposit/src/bitcoin.nr's BTC_SIGNET_CHAIN_TAG
// global, computed the same way (see that file's own comment for the raw
// keccak256 value before reduction).
export const BTC_SIGNET_CHAIN_TAG = 0x2ac72b3cb8eec47a6203b2844aeb349dab822dfe065090e5398a833c8fd323d8n;

/** bitcoin.nr's `deposit_nullifier`: Poseidon2 over a txid's (lo, hi) limbs plus the chain tag (3-arity, domain-separating it from every other nullifier this project computes). */
export function depositNullifier(txid: Buffer): bigint {
  const { lo, hi } = bytes32ToLimbs(txid);
  return poseidon2Hash([lo, hi, BTC_SIGNET_CHAIN_TAG]);
}

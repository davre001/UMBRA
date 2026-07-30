import { keccak256, toBytes, type Hex } from "viem";

// Every note this wallet ever uses is derived from one wallet signature —
// same wallet always regenerates the same spending key, no separate backup
// needed. The message is fixed and non-transactional (doesn't authorize
// spending anything by itself) so it's safe to request once per session.
export const DERIVATION_MESSAGE =
  "Umbra Shielded Wallet\n\nSign to derive your private note keys. This signature never leaves your device and does not authorize any transaction.";

const FIELD_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

function deriveField(signature: Hex, label: string, index: number | ""): bigint {
  const hash = keccak256(toBytes(`umbra-note:${signature}:${label}:${index}`));
  return BigInt(hash) % FIELD_PRIME;
}

/**
 * A wallet's single persistent spending key — reused across every note it
 * owns (see circuits/DESIGN.md). Only its derived `ownerKey` is ever
 * published; this value never leaves the browser.
 */
export function deriveSpendingKey(walletSignature: Hex): bigint {
  return deriveField(walletSignature, "spending-key", "");
}

/** Fresh per-note blinding factor — index 0, 1, 2, ... one per note this wallet creates for itself. */
export function deriveBlinding(walletSignature: Hex, index: number): bigint {
  return deriveField(walletSignature, "blinding", index);
}

/**
 * Order commitments don't use the spendingKey/blinding split (see
 * circuits/DESIGN.md's "Paying a different recipient") — each order still
 * needs its own fresh {secret, nullifier} pair, derived per order index.
 */
export interface OrderKeypair {
  secret: bigint;
  nullifier: bigint;
}

export function deriveOrderKeypair(walletSignature: Hex, index: number): OrderKeypair {
  return {
    secret: deriveField(walletSignature, "order-secret", index),
    nullifier: deriveField(walletSignature, "order-nullifier", index),
  };
}

/** A fresh random blinding for a note credited to someone else's ownerKey — not reproducible, doesn't need to be. */
export function randomBlinding(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(31)); // < 2^248, comfortably under FIELD_PRIME
  let value = BigInt(0);
  for (const b of bytes) value = (value << BigInt(8)) | BigInt(b);
  return value % FIELD_PRIME;
}

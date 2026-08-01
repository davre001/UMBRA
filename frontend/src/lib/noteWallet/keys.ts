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

/** Fresh blinding factor — index 0, 1, 2, ... shared across every note and order this wallet creates for itself (one persistent derivation-index counter, not a separate one per kind). */
export function deriveBlinding(walletSignature: Hex, index: number): bigint {
  return deriveField(walletSignature, "blinding", index);
}

/**
 * Deterministic blinding for a shield deposit of `(assetId, amount)`, at
 * this wallet's `salt`-th deposit of that exact pair. Unlike
 * `deriveBlinding`'s plain index (meaningless outside the browser that
 * assigned it), `assetId`/`amount` are already public on-chain the moment a
 * deposit lands (the `shield()` call itself, not a proof) — so a fresh
 * device can recompute this and search on-chain commitments for a match,
 * recovering a self-created deposit note without needing the original
 * browser's local storage. `salt` must be assigned strictly sequentially
 * per `(assetId, amount)` pair (see countDepositNotes / recoverDepositNotes)
 * for both the forward and recovery paths to agree on the same mapping.
 */
export function deriveDepositBlinding(walletSignature: Hex, assetId: bigint, amount: bigint, salt: number): bigint {
  const hash = keccak256(toBytes(`umbra-note:${walletSignature}:deposit-blinding:${assetId.toString()}:${amount.toString()}:${salt}`));
  return BigInt(hash) % FIELD_PRIME;
}

/** A fresh random blinding for a note credited to someone else's ownerKey — not reproducible, doesn't need to be. */
export function randomBlinding(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(31)); // < 2^248, comfortably under FIELD_PRIME
  let value = BigInt(0);
  for (const b of bytes) value = (value << BigInt(8)) | BigInt(b);
  return value % FIELD_PRIME;
}

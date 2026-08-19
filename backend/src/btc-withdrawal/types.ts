/**
 * A withdrawal request observed via ShieldedVault's `ExternalWithdrawalRequested`
 * event — the ZK proof and nullifier tracking are exactly as real as any
 * other withdrawal; this record just tracks whether the off-chain (Bitcoin)
 * side has been fulfilled yet. Keyed by `nullifierHash`, not a random id —
 * the nullifier IS the natural, unique, already-on-chain identity for a
 * withdrawal, and using it directly (rather than inventing a parallel id)
 * is what makes idempotency trivial: `isSpentNullifier` on the EVM side and
 * this record's own existence are the same fact viewed from two sides.
 */
export interface BtcWithdrawalRequest {
  nullifierHash: string;
  assetId: string;
  /** The low 160 bits of withdraw()'s `recipient` public input, reinterpreted as a Bitcoin P2WPKH pubkey hash (hash160) — see ShieldedVault.sol's ExternalWithdrawalRequested NatSpec. */
  destinationHash160: string;
  amountSats: string;
  /**
   * `awaiting_signatures` sits between `pending` and `broadcast`, added for
   * the 2-of-3 reserve (see reserve.ts): once `attemptFulfillment` stages a
   * real spending PSBT against the reserve's UTXOs, this backend can't
   * finish the job alone anymore — it has no reserve private key — so the
   * record waits here until scripts/sign-btc-withdrawal.ts's own signers
   * collectively provide >= threshold signatures.
   */
  status: "pending" | "awaiting_signatures" | "broadcast" | "failed";
  /** Base64-encoded PSBT (see bitcoinjs-lib's Psbt) — set once `attemptFulfillment` stages it, updated in place as signers' partial signatures get combined in, cleared once broadcast. */
  psbt?: string;
  /** Real signet txid once broadcast. */
  payoutTxid?: string;
  /** Wall-clock time this record was actually broadcast (not requested) — the timestamp rate-limit.ts's rolling-window sums key off, since a withdrawal can sit `pending` for a while before it's actually paid out. */
  broadcastAt?: number;
  failureReason?: string;
  requestedAtBlock: string;
  observedAt: number;
}

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
  status: "pending" | "broadcast" | "failed";
  /** Real signet txid once broadcast. */
  payoutTxid?: string;
  failureReason?: string;
  requestedAtBlock: string;
  observedAt: number;
}

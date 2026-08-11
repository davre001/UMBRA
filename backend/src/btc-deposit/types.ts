/**
 * A pending BTC deposit — submitted once the depositor's real signet
 * payment (see circuits/BTC_DEPOSIT_DESIGN.md's fixed OP_RETURN+P2WPKH
 * template) has confirmed. `ownerKey`/`amountSats` are NOT secrets — both
 * are already public, readable directly from the confirmed Bitcoin
 * transaction itself — they're carried here only for display/bookkeeping.
 * `blinding` IS the one thing keeping this deposit's UMBRA-side
 * note_commitment unlinkable to the public BTC payment it came from; see
 * this module's own top-level privacy note for why the proving service
 * (this backend + its worker) necessarily learns it anyway, unlike every
 * other UMBRA circuit's client-side-only proving.
 */
export interface BtcDepositRecord {
  id: string;
  txid: string;
  checkpointHeight: number;
  ownerKey: string;
  amountSats: string;
  blinding: string;
  status: "awaiting_proof" | "proven" | "failed";
  /** Set once a worker completes proving. */
  proof?: `0x${string}`;
  /** [checkpointCommitment, noteCommitment, nullifier] — circuit's public-input order (see BTC_DEPOSIT_DESIGN.md). */
  publicInputs?: [string, string, string];
  failureReason?: string;
  submittedAt: number;
}

/** Everything a proving worker needs to run the btc_deposit circuit — see contract/circuits/noir/btc_deposit/src/main.nr's parameter list, in that exact order. */
export interface BtcDepositCircuitInputs {
  checkpointHash: string; // 32 bytes, hex, native (non-display-reversed) order
  headers: string[]; // 6 × 80 bytes, hex, native order
  tx: string; // 125 bytes, hex — the real transaction's non-witness serialization
  merklePathElements: string[]; // 20 × 32 bytes, hex, native order (zero-padded past actualDepth)
  merklePathIndices: boolean[]; // 20
  merkleActualDepth: number;
  ownerKey: string; // decimal, extracted from the tx's OP_RETURN — not private, informational
  amountSats: string; // decimal, extracted from the tx's P2WPKH output — not private, informational
}

/**
 * A pending BTC deposit — submitted once the depositor's real signet
 * payment (see circuits/BTC_DEPOSIT_DESIGN.md's fixed OP_RETURN+P2WPKH
 * template) has confirmed. `recipient`/`amountSats` are read straight off
 * the confirmed Bitcoin transaction itself — both already public the
 * moment it confirms, carried here only for display/bookkeeping. Unlike
 * the old private-note design, there is no secret blinding value: the
 * circuit now binds `recipient` (the depositor's own EVM address) directly
 * into the proof, and the mint lands as an ordinary public ERC20 balance —
 * nothing here is ever unlinkable, so there's nothing left to protect.
 */
export interface BtcDepositRecord {
  id: string;
  txid: string;
  checkpointHeight: number;
  recipient: `0x${string}`;
  amountSats: string;
  status: "awaiting_proof" | "proven" | "minted" | "failed";
  /** Set once a worker completes proving. */
  proof?: `0x${string}`;
  /** [checkpointCommitment, recipient, amount, nullifier] — circuit's public-input order (see bitcoin::parse_deposit_tx / main.nr). */
  publicInputs?: [string, string, string, string];
  /** Set once the auto-minter's depositExternal call confirms — see minter.ts. */
  mintTxHash?: `0x${string}`;
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
  recipient: `0x${string}`; // extracted from the tx's OP_RETURN — the depositor's own EVM address, already public
  amountSats: string; // decimal, extracted from the tx's P2WPKH output — not private, informational
}

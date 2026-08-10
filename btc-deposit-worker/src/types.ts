// Mirrors backend/src/btc-deposit/types.ts's BtcDepositCircuitInputs
// exactly (same reason this package doesn't import from backend/ — see
// prove.ts's own comment). The GET /proof-inputs response also includes
// `id` and `blinding` alongside these fields.
export interface BtcDepositProofInputs {
  id: string;
  blinding: string;
  checkpointHash: string;
  headers: string[];
  tx: string;
  merklePathElements: string[];
  merklePathIndices: boolean[];
  merkleActualDepth: number;
  ownerKey: string;
  amountSats: string;
}

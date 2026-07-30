/**
 * An order's private preimage, submitted by its own trader after `placeOrder`
 * confirms on-chain. Same trust tradeoff Wraith's matcher docs disclose for
 * their own dark pool: the matcher CAN see submitted order details (asset,
 * amount, price bound) but CANNOT steal funds or redirect settlement — every
 * output note it builds must reproduce a commitment the on-chain UltraHonk
 * verifier accepts, and that commitment is bound to each trader's own
 * published `ownerKey`, never the matcher's.
 */
export interface OrderIntent {
  /** order_commitment — the leaf this order occupies in ShieldedVault's tree. */
  commitment: string;
  /** On-chain leaf index, from the OrderPlaced event. */
  leafIndex: number;
  nullifier: string;
  secret: string;
  amountIn: string;
  assetIn: number;
  assetOut: number;
  minAmountOut: string;
  /** The trader's own published ownerKey — the matched output note is credited here, never to a matcher-controlled key. */
  ownerKey: string;
  /** Wallet address to deliver the matched note's private data to, via StealthAnnouncer. */
  walletAddress: string;
  submittedAt: number;
}

export type PublicOrderView = Pick<OrderIntent, "commitment" | "submittedAt">;

export interface MatchOrderSide {
  secret: bigint;
  nullifier: bigint;
  amountIn: bigint;
  assetIn: bigint;
  assetOut: bigint;
  minAmountOut: bigint;
  pathElements: bigint[];
  pathIndices: boolean[];
  outOwnerKey: bigint;
  outBlinding: bigint;
}

export interface MatchProofInputs {
  root: bigint;
  nullifierHashA: bigint;
  nullifierHashB: bigint;
  outCommitmentA: bigint;
  outCommitmentB: bigint;
  a: MatchOrderSide;
  b: MatchOrderSide;
}

export interface MatchRecord {
  id: string;
  orderA: OrderIntent;
  orderB: OrderIntent;
  proofInputs: MatchProofInputs;
  status: "awaiting_proof" | "submitted";
  txHash?: `0x${string}`;
  matchedAt: number;
}

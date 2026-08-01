/**
 * An order's private preimage, submitted by its own trader after `placeOrder`
 * confirms on-chain. A disclosed trust tradeoff: the matcher CAN see
 * submitted order details (asset, amount, price bound) but CANNOT steal
 * funds or redirect settlement — every output note it builds must reproduce
 * a commitment the on-chain UltraHonk verifier accepts, and that commitment
 * is bound to each trader's own published `ownerKey`, never the matcher's.
 *
 * `spendingKey` is this wallet's persistent note-spending key, reused as the
 * order's own owner_key(spendingKey) too (circuits/DESIGN.md's "an order"
 * section) — needed here because match_orders is proven off-chain by a
 * separate worker (see matcher-worker/), not the trader's own browser, so
 * whoever builds that proof needs the real spending_key witness, not just
 * the order's public ownerKey. A narrower, order-only key would avoid
 * disclosing anything about this wallet's regular notes to the matcher, but
 * would have meant a second circuit parameter — deferred; see DESIGN.md's
 * "known simplification" for the actual (narrow, collusion-only, no
 * fund-theft) exposure this creates.
 */
export interface OrderIntent {
  /** order_commitment — the leaf this order occupies in ShieldedVault's tree. */
  commitment: string;
  /** On-chain leaf index, from the OrderPlaced (or a residual's OrdersMatched) event. */
  leafIndex: number;
  spendingKey: string;
  /** Blinding used when this order commitment was created — needed to recompute the leaf. */
  orderBlinding: string;
  amountIn: string;
  assetIn: number;
  assetOut: number;
  minAmountOut: string;
  /** owner_key(spendingKey) — kept alongside for convenience; the matcher can also derive it. */
  ownerKey: string;
  /** Wallet address to deliver matched proceeds / a residual order to, via StealthAnnouncer. */
  walletAddress: string;
  /** This order's size before any partial fills ever reduced it — equal to amountIn for a freshly-placed order, carried through unchanged to any residual derived from it. Lets the trader's wallet show fill progress. */
  originalAmountIn: string;
  submittedAt: number;
}

export type PublicOrderView = Pick<OrderIntent, "commitment" | "submittedAt">;

export interface MatchOrderSide {
  spendingKey: bigint;
  orderBlinding: bigint;
  amountIn: bigint;
  assetIn: bigint;
  assetOut: bigint;
  minAmountOut: bigint;
  pathElements: bigint[];
  pathIndices: boolean[];
  outBlinding: bigint;
  /** Fresh blinding for this side's residual order, if any — always generated, only used on-chain when the side isn't fully filled. */
  residualBlinding: bigint;
  /** Set when fill < amountIn — the leftover re-committed as a smaller order under the same owner_key. */
  residual?: { amountIn: bigint; minAmountOut: bigint; commitment: bigint };
}

export interface MatchProofInputs {
  root: bigint;
  nullifierHashA: bigint;
  nullifierHashB: bigint;
  outCommitmentA: bigint;
  outCommitmentB: bigint;
  /** ZERO_VALUE (see shared/merkleTree.ts) when that side has no residual. */
  residualCommitmentA: bigint;
  residualCommitmentB: bigint;
  fillA: bigint;
  fillB: bigint;
  a: MatchOrderSide;
  b: MatchOrderSide;
}

export interface MatchRecord {
  id: string;
  orderA: OrderIntent;
  orderB: OrderIntent;
  proofInputs: MatchProofInputs;
  /**
   * `settled` reflects on-chain reality (the matchOrders tx landed,
   * nullifiers are spent) — it's set the instant that tx confirms, before
   * announcing either side, specifically so a delivery failure afterward
   * can never leave a genuinely-settled match still reporting
   * `awaiting_proof` (which would make it look retriable when re-submitting
   * the same proof would just revert with NullifierAlreadySpent).
   */
  status: "awaiting_proof" | "settled";
  txHash?: `0x${string}`;
  /**
   * Independent per-announcement delivery tracking — a settled match can
   * still have any of these undelivered if announcing failed partway.
   * Each side needs its matched-proceeds note announced always, and (only
   * if `proofInputs.a`/`b`.residual is set) its residual order announced
   * too — see matcher.ts's `deliverAnnouncements`.
   */
  announcedNoteA: boolean;
  announcedResidualA: boolean;
  announcedNoteB: boolean;
  announcedResidualB: boolean;
  matchedAt: number;
}

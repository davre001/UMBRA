import type { OrderIntent, PublicOrderView } from "./types";

/**
 * Cheap, synchronous pre-filter: do these two orders even trade the same
 * asset pair in opposite directions? Necessary but not sufficient — whether
 * a *valid* fill actually exists (clearing both sides' pro-rata minimums at
 * a fair rate) needs live FTSO data and real arithmetic, see
 * fillSizing.ts's `computeFill`. Kept separate so the book can filter its
 * full candidate list synchronously before paying for any async price
 * lookups.
 */
export function isCompatible(a: OrderIntent, b: OrderIntent): boolean {
  return a.assetOut === b.assetIn && b.assetOut === a.assetIn;
}

export class OrderBook {
  private readonly open = new Map<string, OrderIntent>();

  /** All resting orders compatible with `order` by the pure asset-cross pre-filter, in submission-order priority — doesn't remove or add anything, so a caller can apply an additional async check (fillSizing.ts's `computeFill`) before committing to one. */
  findCandidates(order: OrderIntent): OrderIntent[] {
    return [...this.open.values()].filter((resting) => isCompatible(order, resting));
  }

  /** Adds `order` to the book without attempting to match it — used both for a genuinely new order and to re-list a partial fill's residual. */
  rest(order: OrderIntent): void {
    this.open.set(order.commitment, order);
  }

  /** Removes an order without matching it — used when a candidate is claimed for a match, or for operator cleanup. */
  remove(commitment: string): void {
    this.open.delete(commitment);
  }

  list(): PublicOrderView[] {
    // Commitments only, never order details — same disclosure boundary the
    // rest of this module's docs describe for the matcher as a whole.
    return [...this.open.values()].map((o) => ({ commitment: o.commitment, submittedAt: o.submittedAt }));
  }

  get(commitment: string): OrderIntent | undefined {
    return this.open.get(commitment);
  }
}

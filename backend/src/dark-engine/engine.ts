import type { OrderIntent, PublicOrderView } from "./types";

/**
 * Real order book + compatibility check — a direct mirror of
 * `match_orders`'s own constraints (contract/circuits/noir/match_orders/
 * src/main.nr), not an approximation: assets must actually cross, and each
 * side must clear the other's minimum acceptable amount. There's no
 * partial-fill or price-improvement logic to mirror beyond that — unlike
 * Wraith's matcher, our circuit does an exact bilateral cross only (see
 * circuits/DESIGN.md's "known simplification, v1"), so any two orders
 * satisfying these four inequalities are a complete, valid match as-is.
 */
export function isCompatible(a: OrderIntent, b: OrderIntent): boolean {
  return (
    a.assetOut === b.assetIn &&
    b.assetOut === a.assetIn &&
    BigInt(b.amountIn) >= BigInt(a.minAmountOut) &&
    BigInt(a.amountIn) >= BigInt(b.minAmountOut)
  );
}

export class OrderBook {
  private readonly open = new Map<string, OrderIntent>();

  /** Adds `order` to the book and returns the first compatible resting order, if any (submission-order priority — first opened, first matched). */
  submit(order: OrderIntent): OrderIntent | null {
    for (const resting of this.open.values()) {
      if (isCompatible(order, resting)) {
        this.open.delete(resting.commitment);
        return resting;
      }
    }
    this.open.set(order.commitment, order);
    return null;
  }

  /** Removes an order without matching it — used when a match's proof/submission ultimately fails and the order needs to go back on the book, or for operator cleanup. */
  remove(commitment: string): void {
    this.open.delete(commitment);
  }

  requeue(order: OrderIntent): void {
    this.open.set(order.commitment, order);
  }

  list(): PublicOrderView[] {
    // Commitments only, never order details — same disclosure boundary
    // Wraith's matcher documents for its own GET /orders.
    return [...this.open.values()].map((o) => ({ commitment: o.commitment, submittedAt: o.submittedAt }));
  }

  get(commitment: string): OrderIntent | undefined {
    return this.open.get(commitment);
  }
}

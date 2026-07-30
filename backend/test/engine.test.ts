import { describe, it, expect } from "vitest";
import { OrderBook, isCompatible } from "../src/dark-engine/engine";
import type { OrderIntent } from "../src/dark-engine/types";

function order(overrides: Partial<OrderIntent>): OrderIntent {
  return {
    commitment: "0x1",
    leafIndex: 0,
    nullifier: "1",
    secret: "1",
    amountIn: "1000",
    assetIn: 0,
    assetOut: 1,
    minAmountOut: "900",
    ownerKey: "1",
    walletAddress: "0x0000000000000000000000000000000000dEaD",
    submittedAt: Date.now(),
    ...overrides,
  };
}

// Mirrors the exact match_orders circuit test vectors (contract/circuits/
// noir/match_orders/src/main.nr's #[test] fn test_match_orders /
// test_match_orders_rejects_incompatible_assets).
describe("isCompatible", () => {
  it("accepts orders that cross exactly like the circuit's own passing test vector", () => {
    const a = order({ commitment: "0xa", amountIn: "1000", assetIn: 0, assetOut: 1, minAmountOut: "900" });
    const b = order({ commitment: "0xb", amountIn: "950", assetIn: 1, assetOut: 0, minAmountOut: "800" });
    expect(isCompatible(a, b)).toBe(true);
  });

  it("rejects orders on mismatched assets, like the circuit's should_fail vector", () => {
    const a = order({ commitment: "0xa", amountIn: "1000", assetIn: 0, assetOut: 1, minAmountOut: "900" });
    const b = order({ commitment: "0xb", amountIn: "950", assetIn: 2, assetOut: 0, minAmountOut: "800" });
    expect(isCompatible(a, b)).toBe(false);
  });

  it("rejects when a side wouldn't clear its counterparty's minimum", () => {
    const a = order({ commitment: "0xa", amountIn: "1000", assetIn: 0, assetOut: 1, minAmountOut: "9999" });
    const b = order({ commitment: "0xb", amountIn: "950", assetIn: 1, assetOut: 0, minAmountOut: "800" });
    expect(isCompatible(a, b)).toBe(false);
  });
});

describe("OrderBook", () => {
  it("rests an order with no compatible counterparty", () => {
    const book = new OrderBook();
    const result = book.submit(order({ commitment: "0xa" }));
    expect(result).toBeNull();
    expect(book.list().map((o) => o.commitment)).toEqual(["0xa"]);
  });

  it("matches a new order against a resting compatible one and removes both from the book", () => {
    const book = new OrderBook();
    const a = order({ commitment: "0xa", amountIn: "1000", assetIn: 0, assetOut: 1, minAmountOut: "900" });
    const b = order({ commitment: "0xb", amountIn: "950", assetIn: 1, assetOut: 0, minAmountOut: "800" });
    expect(book.submit(a)).toBeNull();
    const match = book.submit(b);
    expect(match?.commitment).toBe("0xa");
    expect(book.list()).toEqual([]);
  });

  it("does not match an incompatible resting order", () => {
    const book = new OrderBook();
    const a = order({ commitment: "0xa", amountIn: "1000", assetIn: 0, assetOut: 1, minAmountOut: "900" });
    const c = order({ commitment: "0xc", amountIn: "950", assetIn: 2, assetOut: 0, minAmountOut: "800" });
    book.submit(a);
    expect(book.submit(c)).toBeNull();
    expect(book.list().map((o) => o.commitment).sort()).toEqual(["0xa", "0xc"]);
  });
});

import { describe, it, expect } from "vitest";
import { OrderBook, isCompatible } from "../src/dark-engine/engine";
import type { OrderIntent } from "../src/dark-engine/types";

function order(overrides: Partial<OrderIntent>): OrderIntent {
  return {
    commitment: "0x1",
    leafIndex: 0,
    spendingKey: "1",
    orderBlinding: "1",
    amountIn: "1000",
    originalAmountIn: "1000",
    assetIn: 0,
    assetOut: 1,
    minAmountOut: "900",
    ownerKey: "1",
    walletAddress: "0x0000000000000000000000000000000000dEaD",
    submittedAt: Date.now(),
    ...overrides,
  };
}

// isCompatible is now just the asset-cross pre-filter — whether a valid
// fill actually exists (clearing both sides' pro-rata minimums) needs live
// FTSO data, see fillSizing.test.ts's computeFill tests.
describe("isCompatible", () => {
  it("accepts orders that cross on the same asset pair", () => {
    const a = order({ commitment: "0xa", assetIn: 0, assetOut: 1 });
    const b = order({ commitment: "0xb", assetIn: 1, assetOut: 0 });
    expect(isCompatible(a, b)).toBe(true);
  });

  it("rejects orders on mismatched assets", () => {
    const a = order({ commitment: "0xa", assetIn: 0, assetOut: 1 });
    const b = order({ commitment: "0xb", assetIn: 2, assetOut: 0 });
    expect(isCompatible(a, b)).toBe(false);
  });
});

describe("OrderBook", () => {
  it("rest() adds an order that list() then reports", () => {
    const book = new OrderBook();
    book.rest(order({ commitment: "0xa" }));
    expect(book.list().map((o) => o.commitment)).toEqual(["0xa"]);
  });

  it("findCandidates() finds a resting order compatible with a new one, without removing it", () => {
    const book = new OrderBook();
    const a = order({ commitment: "0xa", assetIn: 0, assetOut: 1 });
    const b = order({ commitment: "0xb", assetIn: 1, assetOut: 0 });
    book.rest(a);
    expect(book.findCandidates(b).map((o) => o.commitment)).toEqual(["0xa"]);
    expect(book.list().map((o) => o.commitment)).toEqual(["0xa"]); // untouched
  });

  it("findCandidates() excludes an incompatible resting order", () => {
    const book = new OrderBook();
    const a = order({ commitment: "0xa", assetIn: 0, assetOut: 1 });
    const c = order({ commitment: "0xc", assetIn: 2, assetOut: 0 });
    book.rest(a);
    expect(book.findCandidates(c)).toEqual([]);
  });

  it("remove() takes an order off the book", () => {
    const book = new OrderBook();
    book.rest(order({ commitment: "0xa" }));
    book.remove("0xa");
    expect(book.list()).toEqual([]);
  });
});

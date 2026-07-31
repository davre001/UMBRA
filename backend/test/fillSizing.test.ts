import { describe, it, expect } from "vitest";
import { computeFill } from "../src/dark-engine/fillSizing";
import { getMidpointRate } from "../src/pricing/ftso.client";
import type { OrderIntent } from "../src/dark-engine/types";

function order(overrides: Partial<OrderIntent>): OrderIntent {
  return {
    commitment: "0x1",
    leafIndex: 0,
    spendingKey: "1",
    orderBlinding: "1",
    amountIn: "1000",
    assetIn: 0,
    assetOut: 1,
    minAmountOut: "1",
    ownerKey: "1",
    walletAddress: "0x0000000000000000000000000000000000dEaD",
    submittedAt: Date.now(),
    ...overrides,
  };
}

// Real FTSOv2 reads, no mocking — amounts are derived from the live rate at
// test time so this doesn't flake as real prices move.
describe("computeFill", () => {
  it(
    "fully fills the smaller side and partially fills the larger one at the live fair rate",
    async () => {
      const fairRate = await getMidpointRate("C2FLR", "FXRP"); // 1 C2FLR in FXRP
      const c2flrAmountHuman = 1000;
      const fxrpAmountHuman = fairRate * c2flrAmountHuman * 2; // twice what's needed — B is the larger side

      const a = order({
        amountIn: (BigInt(c2flrAmountHuman) * BigInt(10) ** BigInt(18)).toString(),
        assetIn: 0,
        assetOut: 1,
        minAmountOut: "1",
      });
      const b = order({
        amountIn: String(Math.round(fxrpAmountHuman * 10 ** 6)),
        assetIn: 1,
        assetOut: 0,
        minAmountOut: "1",
      });

      const fill = await computeFill(a, b);
      expect(fill).not.toBeNull();
      expect(fill!.fillA).toBe(BigInt(a.amountIn)); // A (the smaller side) fully fills
      expect(fill!.fillB).toBeLessThan(BigInt(b.amountIn)); // B has a residual
      expect(fill!.fillB).toBeGreaterThan(BigInt(0));
    },
    20_000
  );

  it(
    "rejects a pair whose minimums can't both clear at the live fair rate",
    async () => {
      const fairRate = await getMidpointRate("C2FLR", "FXRP");
      const c2flrAmountHuman = 1000;
      const fxrpAmountHuman = fairRate * c2flrAmountHuman;

      const a = order({
        amountIn: (BigInt(c2flrAmountHuman) * BigInt(10) ** BigInt(18)).toString(),
        assetIn: 0,
        assetOut: 1,
        // Demands far more FXRP per C2FLR than the live rate offers.
        minAmountOut: String(Math.round(fxrpAmountHuman * 100 * 10 ** 6)),
      });
      const b = order({
        amountIn: String(Math.round(fxrpAmountHuman * 10 ** 6)),
        assetIn: 1,
        assetOut: 0,
        minAmountOut: "1",
      });

      const fill = await computeFill(a, b);
      expect(fill).toBeNull();
    },
    20_000
  );

  it("rejects mismatched assets without an FTSO lookup", async () => {
    const a = order({ assetIn: 0, assetOut: 1 });
    const b = order({ assetIn: 2, assetOut: 0 });
    const fill = await computeFill(a, b);
    expect(fill).toBeNull();
  });
});

import { getMidpointRate } from "../pricing/ftso.client";
import { assetById } from "../shared/chain";
import type { OrderIntent } from "./types";

/**
 * Sizes a real (possibly partial) fill between two crossing orders, pinned
 * to the live FTSOv2 rate — replaces the old "does the orders' own implied
 * rate deviate too much from fair" tolerance check (priceCheck.ts) with
 * something stronger: since the fill amount is *computed from* the fair
 * rate rather than independently compared to it, the realized rate for the
 * portion actually filled is the live fair rate by construction, not just
 * "close enough" to it.
 *
 * Sizing itself uses floating-point FTSO rates (same precedent as the old
 * tolerance check) and is only a *proposal* — `match_orders`'s own
 * mul_div_floor pro-rata checks (contract/circuits/noir/match_orders) are
 * the actual authority, so this function re-verifies its own proposal with
 * exact integer arithmetic before returning it, mirroring the circuit's own
 * math bit for bit. If the fair-rate-derived fill doesn't clear both sides'
 * pro-rata minimums, it returns null rather than a proposal a real proof
 * could never satisfy.
 */
export interface Fill {
  fillA: bigint;
  fillB: bigint;
  fairRate: number;
}

export async function computeFill(a: OrderIntent, b: OrderIntent): Promise<Fill | null> {
  if (a.assetOut !== b.assetIn || b.assetOut !== a.assetIn) return null;

  const assetInA = assetById(a.assetIn);
  const assetInB = assetById(b.assetIn);
  const fairRate = await getMidpointRate(assetInA.symbol, assetInB.symbol); // units of B's asset per unit of A's asset

  const aAmountIn = BigInt(a.amountIn);
  const bAmountIn = BigInt(b.amountIn);
  if (aAmountIn === BigInt(0) || bAmountIn === BigInt(0)) return null;

  const aAmountHuman = Number(aAmountIn) / 10 ** assetInA.decimals;
  const bAmountHuman = Number(bAmountIn) / 10 ** assetInB.decimals;
  // How much of A's asset B's full amount could buy at the fair rate.
  const bInAUnitsHuman = bAmountHuman / fairRate;

  let fillA: bigint;
  let fillB: bigint;
  if (aAmountHuman <= bInAUnitsHuman) {
    // A is the smaller side (in fair-rate terms) — fill it exactly, size B's side from the rate.
    fillA = aAmountIn;
    const fillBHuman = aAmountHuman * fairRate;
    fillB = BigInt(Math.floor(fillBHuman * 10 ** assetInB.decimals));
    if (fillB > bAmountIn) fillB = bAmountIn;
  } else {
    fillB = bAmountIn;
    const fillAHuman = bAmountHuman / fairRate;
    fillA = BigInt(Math.floor(fillAHuman * 10 ** assetInA.decimals));
    if (fillA > aAmountIn) fillA = aAmountIn;
  }
  if (fillA <= BigInt(0) || fillB <= BigInt(0)) return null;

  // Re-verify with exact integer math — the same mul_div_floor pro-rata
  // check match_orders itself performs. A fair-rate sizing that doesn't
  // clear this (e.g. from float rounding) is rejected, not fudged.
  const aMinAmountOut = BigInt(a.minAmountOut);
  const bMinAmountOut = BigInt(b.minAmountOut);
  const aRequiredMin = (fillA * aMinAmountOut) / aAmountIn;
  if (fillB < aRequiredMin) return null;
  const bRequiredMin = (fillB * bMinAmountOut) / bAmountIn;
  if (fillA < bRequiredMin) return null;

  return { fillA, fillB, fairRate };
}

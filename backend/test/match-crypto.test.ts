import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { commitment, nullifierHash, orderCommitment, ownerKey } from "../src/shared/poseidon2";
import { MerkleTree, ZERO_VALUE } from "../src/shared/merkleTree";

/**
 * Cross-checks the exact commitment/Merkle/nullifier math dark-engine's
 * prover.ts uses against contract/circuits/noir/match_orders's own real,
 * on-chain-verified fixture (see circuits/scripts/noir-onchain-verify.ts —
 * that fixture's proof was independently confirmed to verify on-chain).
 * If this test passes, the TS assembly logic here produces byte-identical
 * public inputs to what the real Noir circuit and on-chain verifier expect
 * — checked without touching the chain or running any proving. Fixture is a
 * genuine partial fill at realistic 18-decimal scale (a 50-token order fully fills
 * against a larger FXRP order, which keeps a residual) — see the circuit's
 * own #[test] fn test_match_orders_partial_fill_at_realistic_18_decimal_scale,
 * the exact magnitude that first exposed assert_64 as too tight for this
 * project's real asset decimals (caught via a real end-to-end matcher-worker
 * run, not a unit test — see contract/deployments/coston2.json's own note).
 */
const FIXTURES = path.join(__dirname, "../../contract/circuits/noir/match_orders/fixtures");

function loadFixturePublicInputs(): bigint[] {
  const raw = readFileSync(path.join(FIXTURES, "public_inputs"));
  const values: bigint[] = [];
  for (let i = 0; i < 7; i++) {
    values.push(BigInt("0x" + raw.subarray(i * 32, (i + 1) * 32).toString("hex")));
  }
  return values;
}

describe("match_orders commitment/Merkle assembly vs. the real circuit fixture", () => {
  it("reproduces the fixture's root, nullifier hashes, output commitments, and residual exactly", () => {
    const [fixtureRoot, fixtureNullifierA, fixtureNullifierB, fixtureOutA, fixtureOutB, fixtureResidualA, fixtureResidualB] =
      loadFixturePublicInputs();

    // Same order preimages as the fixture's Prover.toml / the circuit's own
    // #[test] fn test_match_orders_partial_fill_at_realistic_18_decimal_scale.
    const aSpendingKey = BigInt(111);
    const aOrderBlinding = BigInt(222);
    const aAmountIn = BigInt("50000000000000000000"); // 50 tokens at 18 decimals
    const aAssetIn = BigInt(0);
    const aAssetOut = BigInt(1);
    const aMinAmountOut = BigInt(1);

    const bSpendingKey = BigInt(333);
    const bOrderBlinding = BigInt(444);
    const bAmountIn = BigInt(578349); // ~0.578349 FXRP
    const bAssetIn = BigInt(1);
    const bAssetOut = BigInt(0);
    const bMinAmountOut = BigInt(1);

    const leafA = orderCommitment(ownerKey(aSpendingKey), aOrderBlinding, aAmountIn, aAssetIn, aAssetOut, aMinAmountOut);
    const leafB = orderCommitment(ownerKey(bSpendingKey), bOrderBlinding, bAmountIn, bAssetIn, bAssetOut, bMinAmountOut);

    const tree = new MerkleTree([leafA, leafB], 1);
    expect(tree.root).toBe(fixtureRoot);

    expect(nullifierHash(leafA, aSpendingKey)).toBe(fixtureNullifierA);
    expect(nullifierHash(leafB, bSpendingKey)).toBe(fixtureNullifierB);

    const fillA = aAmountIn; // A fully fills
    const fillB = BigInt(289175); // about half of B's amount

    const aOutBlinding = BigInt(555);
    const bOutBlinding = BigInt(666);
    const outCommitmentA = commitment(bAssetIn, fillB, ownerKey(aSpendingKey), aOutBlinding);
    const outCommitmentB = commitment(aAssetIn, fillA, ownerKey(bSpendingKey), bOutBlinding);

    expect(outCommitmentA).toBe(fixtureOutA);
    expect(outCommitmentB).toBe(fixtureOutB);

    // A is fully filled — no residual.
    expect(fixtureResidualA).toBe(ZERO_VALUE);

    // B has a residual, min_amount_out scaled pro-rata (floor(remaining * 1 / 578349) = 0 here since bMinAmountOut is 1).
    const bResidualBlinding = BigInt(999);
    const bResidualAmount = bAmountIn - fillB;
    const bResidualMin = (bResidualAmount * bMinAmountOut) / bAmountIn;
    const residualCommitmentB = orderCommitment(ownerKey(bSpendingKey), bResidualBlinding, bResidualAmount, bAssetIn, bAssetOut, bResidualMin);

    expect(residualCommitmentB).toBe(fixtureResidualB);
  });
});

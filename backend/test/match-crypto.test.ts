import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { commitment, nullifierHash, orderCommitment } from "../src/shared/poseidon2";
import { MerkleTree } from "../src/shared/merkleTree";

/**
 * Cross-checks the exact commitment/Merkle/nullifier math dark-engine's
 * prover.ts uses against contract/circuits/noir/match_orders's own real,
 * on-chain-verified fixture (see circuits/scripts/noir-onchain-verify.ts —
 * that fixture's proof was independently confirmed to verify on-chain).
 * If this test passes, the TS assembly logic here produces byte-identical
 * public inputs to what the real Noir circuit and on-chain verifier expect
 * — checked without touching the chain or running any proving.
 */
const FIXTURES = path.join(__dirname, "../../contract/circuits/noir/match_orders/fixtures");

function loadFixturePublicInputs(): bigint[] {
  const raw = readFileSync(path.join(FIXTURES, "public_inputs"));
  const values: bigint[] = [];
  for (let i = 0; i < 5; i++) {
    values.push(BigInt("0x" + raw.subarray(i * 32, (i + 1) * 32).toString("hex")));
  }
  return values;
}

describe("match_orders commitment/Merkle assembly vs. the real circuit fixture", () => {
  it("reproduces the fixture's root, nullifier hashes, and output commitments exactly", () => {
    const [fixtureRoot, fixtureNullifierA, fixtureNullifierB, fixtureOutA, fixtureOutB] = loadFixturePublicInputs();

    // Same order preimages as the fixture's Prover.toml / the circuit's own #[test] fn test_match_orders.
    const aSecret = BigInt(111);
    const aNullifier = BigInt(222);
    const aAmountIn = BigInt(1000);
    const aAssetIn = BigInt(0);
    const aAssetOut = BigInt(1);
    const aMinAmountOut = BigInt(900);

    const bSecret = BigInt(333);
    const bNullifier = BigInt(444);
    const bAmountIn = BigInt(950);
    const bAssetIn = BigInt(1);
    const bAssetOut = BigInt(0);
    const bMinAmountOut = BigInt(800);

    const leafA = orderCommitment(aNullifier, aSecret, aAmountIn, aAssetIn, aAssetOut, aMinAmountOut);
    const leafB = orderCommitment(bNullifier, bSecret, bAmountIn, bAssetIn, bAssetOut, bMinAmountOut);

    const tree = new MerkleTree([leafA, leafB], 1);
    expect(tree.root).toBe(fixtureRoot);

    expect(nullifierHash(leafA, aNullifier)).toBe(fixtureNullifierA);
    expect(nullifierHash(leafB, bNullifier)).toBe(fixtureNullifierB);

    // Same output owner_key/blinding as the fixture.
    const aOutOwnerKey = BigInt("0x2c2ce65a11269a22ec91515b59f0b41406d1fffd1693bd36134c9e254f7bbc52");
    const aOutBlinding = BigInt(666);
    const bOutOwnerKey = BigInt("0x1459b8a6efe80cd7ca6423e4aead5ee456bc94f2944317d66a3821e472d9cc1c");
    const bOutBlinding = BigInt(888);

    const outCommitmentA = commitment(bAssetIn, bAmountIn, aOutOwnerKey, aOutBlinding);
    const outCommitmentB = commitment(aAssetIn, aAmountIn, bOutOwnerKey, bOutBlinding);

    expect(outCommitmentA).toBe(fixtureOutA);
    expect(outCommitmentB).toBe(fixtureOutB);
  });
});

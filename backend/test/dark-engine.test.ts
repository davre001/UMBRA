import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { CONTRACTS, getWalletClient, publicClient } from "../src/shared/chain";
import { SHIELDED_VAULT_ABI } from "../src/shared/vaultAbi";
import { getMidpointRate } from "../src/pricing/ftso.client";

const app = createApp();

function orderBody(overrides: Record<string, unknown>) {
  return {
    commitment: "0x1",
    leafIndex: 0,
    spendingKey: "1",
    orderBlinding: "1",
    amountIn: "1000",
    assetIn: 0,
    assetOut: 1,
    minAmountOut: "900",
    ownerKey: "1",
    walletAddress: "0x0000000000000000000000000000000000dEaD",
    ...overrides,
  };
}

/**
 * assembleMatchProofInputs needs at least one real on-chain leaf to build a
 * Merkle proof against (the test order commitments below aren't real order
 * leaves — this only exercises the matching/assembly pipeline, not on-chain
 * verification, so reusing any existing leaf index is fine). Self-contained
 * rather than assuming another test file already shielded something first —
 * dark-engine.test.ts runs before relayer.test.ts alphabetically, so it
 * can't rely on that.
 */
let existingLeafIndex = 0;

// Needs a funded PRIVATE_KEY — no-ops in CI (GitHub Actions sets
// process.env.CI automatically), same call this repo already makes
// elsewhere. The two tests that depend on existingLeafIndex/live chain
// state are skipped below; the two that don't (pure request-validation,
// 404 handling) still run.
beforeAll(async () => {
  if (process.env.CI) return;
  const nextLeafIndex = await publicClient.readContract({
    address: CONTRACTS.ShieldedVault as `0x${string}`,
    abi: SHIELDED_VAULT_ABI,
    functionName: "nextLeafIndex",
  });
  if (nextLeafIndex > 0) {
    existingLeafIndex = nextLeafIndex - 1;
    return;
  }

  const wallet = getWalletClient();
  const account = wallet.account!;
  const dustAmount = BigInt(1);

  // assetId 0 is native C2FLR — shield() holds it directly, no wrap/approve
  // step needed (see ShieldedVault.sol's nativeAssetId).
  const shieldHash = await wallet.writeContract({
    address: CONTRACTS.ShieldedVault as `0x${string}`,
    abi: SHIELDED_VAULT_ABI,
    functionName: "shield",
    args: [BigInt(0), dustAmount, BigInt(1)],
    value: dustAmount,
    chain: wallet.chain,
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: shieldHash });
  existingLeafIndex = 0;
}, 60_000);

// Order submission and matching are real (real book, real Merkle-path
// assembly against the live Coston2 vault, real Poseidon2 commitments) —
// only proof generation is stubbed (UnavailableMatchProver, see prover.ts),
// so a genuine match here lands as "awaiting_proof", not "settled".
describe("dark-engine routes", () => {
  it("rejects an order missing required fields", async () => {
    const res = await request(app).post("/api/dark-engine/orders").send({ commitment: "0x1" });
    expect(res.status).toBe(400);
  });

  it.skipIf(!!process.env.CI)("rests an order with no compatible counterparty", async () => {
    const res = await request(app).post("/api/dark-engine/orders").send(orderBody({ commitment: "0xaa", leafIndex: existingLeafIndex }));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("resting");

    const list = await request(app).get("/api/dark-engine/orders");
    expect(list.body.orders.some((o: { commitment: string }) => o.commitment === "0xaa")).toBe(true);
  });

  it.skipIf(!!process.env.CI)(
    "matches a compatible, realistically-priced order against a real resting one and assembles real proof inputs",
    async () => {
      // "0xaa" (submitted earlier, still resting) is compatible by asset/
      // minimum but priced with unrealistic dust amounts — the new price
      // sanity check (priceCheck.ts) should skip it and match "0xbb"
      // instead, which is priced at the live FTSO rate.
      const fairRate = await getMidpointRate("C2FLR", "FXRP"); // 1 C2FLR in FXRP
      const c2flrAmountHuman = 1000;
      const fxrpAmountHuman = fairRate * c2flrAmountHuman;
      // BigInt exponentiation for the (integer) C2FLR side — 1000 * 10^18
      // overflows Number's non-exponential-notation range, and
      // BigInt(String(...)) can't parse "1e+21".
      const c2flrAmountRaw = (BigInt(c2flrAmountHuman) * BigInt(10) ** BigInt(18)).toString();
      const fxrpAmountRaw = String(Math.round(fxrpAmountHuman * 10 ** 6));

      await request(app).post("/api/dark-engine/orders").send(
        orderBody({ commitment: "0xbb", leafIndex: existingLeafIndex, amountIn: c2flrAmountRaw, assetIn: 0, assetOut: 1, minAmountOut: "1" })
      );
      const res = await request(app).post("/api/dark-engine/orders").send(
        orderBody({ commitment: "0xcc", leafIndex: existingLeafIndex, amountIn: fxrpAmountRaw, assetIn: 1, assetOut: 0, minAmountOut: "1" })
      );
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("matched");
      expect(res.body.matchStatus).toBe("awaiting_proof");

      const match = await request(app).get(`/api/dark-engine/matches/${res.body.matchId}`);
      expect(match.status).toBe(200);
      expect(match.body.status).toBe("awaiting_proof");
    },
    // Was 20s; submitOrder now makes one extra live isSpentNullifier
    // readContract call per submission (see matcher.ts) on top of the two
    // real order submissions and real Merkle-path assembly this test already
    // does, pushing total real-network time past the old budget.
    40_000
  );

  it("404s for an unknown match id", async () => {
    const res = await request(app).get("/api/dark-engine/matches/does-not-exist");
    expect(res.status).toBe(404);
  });
});

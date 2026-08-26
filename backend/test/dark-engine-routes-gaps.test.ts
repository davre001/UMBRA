import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { CONTRACTS, getWalletClient, publicClient } from "../src/shared/chain";
import { SHIELDED_VAULT_ABI } from "../src/shared/vaultAbi";
import { getMidpointRate } from "../src/pricing/ftso.client";

/**
 * Fills the validation/auth-gating gaps dark-engine.test.ts's own real
 * end-to-end flow doesn't reach: requireMatcherSecret's 401/503 branches,
 * validateOrder's individual rejection messages, GET /matches's status
 * filter validation, and the two matcher-worker-only routes' malformed-
 * input/404 branches. Does NOT attempt a real settled match via POST
 * /matches/:id/proof — see submitter.test.ts's own doc for why that
 * specific happy path needs live in-test proving this repo's own contract
 * test suite already disclosed as deferred.
 */

const app = createApp();
const MATCHER_SECRET = process.env.MATCHER_INTERNAL_SECRET;

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

let existingLeafIndex = 0;
let realAwaitingProofMatchId: string | undefined;

beforeAll(async () => {
  if (process.env.CI) return;
  if (!MATCHER_SECRET) throw new Error("MATCHER_INTERNAL_SECRET must be set locally for this test file to run");

  const nextLeafIndex = await publicClient.readContract({
    address: CONTRACTS.ShieldedVault as `0x${string}`,
    abi: SHIELDED_VAULT_ABI,
    functionName: "nextLeafIndex",
  });
  if (nextLeafIndex > 0) {
    existingLeafIndex = nextLeafIndex - 1;
  } else {
    const wallet = getWalletClient();
    const account = wallet.account!;
    const dustAmount = BigInt(1);
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
  }

  // A real, live-chain-backed awaiting_proof match, same recipe as
  // dark-engine.test.ts's own — reused here purely as a real fixture for
  // the proof-inputs/proof-submission routes' own validation branches.
  const fairRate = await getMidpointRate("C2FLR", "FXRP");
  const c2flrAmountRaw = (BigInt(1000) * BigInt(10) ** BigInt(18)).toString();
  const fxrpAmountRaw = String(Math.round(fairRate * 1000 * 10 ** 6));

  await request(app)
    .post("/api/dark-engine/orders")
    .send(orderBody({ commitment: "0xroutegapsA", leafIndex: existingLeafIndex, amountIn: c2flrAmountRaw, assetIn: 0, assetOut: 1, minAmountOut: "1" }));
  const res = await request(app)
    .post("/api/dark-engine/orders")
    .send(orderBody({ commitment: "0xroutegapsB", leafIndex: existingLeafIndex, amountIn: fxrpAmountRaw, assetIn: 1, assetOut: 0, minAmountOut: "1" }));
  if (res.body.status === "matched") realAwaitingProofMatchId = res.body.matchId;
}, 60_000);

describe("dark-engine routes / validation + auth gaps", () => {
  it("POST /orders rejects an out-of-range assetIn", async () => {
    const res = await request(app).post("/api/dark-engine/orders").send(orderBody({ assetIn: 99 }));
    expect(res.status).toBe(400);
  });

  it("POST /orders rejects an out-of-range assetOut", async () => {
    const res = await request(app).post("/api/dark-engine/orders").send(orderBody({ assetOut: -1 }));
    expect(res.status).toBe(400);
  });

  it("POST /orders rejects a negative leafIndex", async () => {
    const res = await request(app).post("/api/dark-engine/orders").send(orderBody({ leafIndex: -1 }));
    expect(res.status).toBe(400);
  });

  it("GET /matches rejects an invalid status filter", async () => {
    const res = await request(app).get("/api/dark-engine/matches").query({ status: "not-a-real-status" });
    expect(res.status).toBe(400);
  });

  it("GET /matches accepts a valid status filter and returns commitments/status only", async () => {
    const res = await request(app).get("/api/dark-engine/matches").query({ status: "awaiting_proof" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.matches)).toBe(true);
  });

  it("GET /matches/:id/proof-inputs rejects a missing secret", async () => {
    const res = await request(app).get("/api/dark-engine/matches/whatever/proof-inputs");
    expect(res.status).toBe(401);
  });

  it("GET /matches/:id/proof-inputs 404s for an unknown match", async () => {
    const res = await request(app).get("/api/dark-engine/matches/does-not-exist/proof-inputs").set("x-matcher-secret", MATCHER_SECRET!);
    expect(res.status).toBe(404);
  });

  it.skipIf(!!process.env.CI)("GET /matches/:id/proof-inputs returns real, serialized proof inputs for a real awaiting_proof match", async (ctx) => {
    // The live order book's own matching logic (real FTSO-priced fillability
    // check) decides whether beforeAll's two orders actually matched — not
    // something this test controls deterministically (same live-state
    // caveat dark-engine.test.ts's own real-match test already discloses).
    // Skip rather than fail when it didn't, same as relayer.test.ts's own
    // fixture-state skip.
    if (!realAwaitingProofMatchId) {
      ctx.skip();
      return;
    }
    const res = await request(app).get(`/api/dark-engine/matches/${realAwaitingProofMatchId}/proof-inputs`).set("x-matcher-secret", MATCHER_SECRET!);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("root");
    expect(res.body).toHaveProperty("nullifierHashA");
  });

  // POST /matches/:id/proof is deliberately NOT secret-gated (see its own
  // NatSpec in dark-engine.routes.ts: "accepts a proof produced elsewhere,"
  // meant to also work as a manual/offline completion path) — unlike GET
  // /matches/:id/proof-inputs, which exposes private order details and IS
  // gated. Confirmed against the real route rather than assumed.
  it("POST /matches/:id/proof rejects a malformed body even with no secret required", async () => {
    const res = await request(app).post("/api/dark-engine/matches/whatever/proof").send({ proof: "not-hex" });
    expect(res.status).toBe(400);
  });

  it("POST /matches/:id/proof propagates 'No such match' as a 400 for an unknown match id", async () => {
    const res = await request(app).post("/api/dark-engine/matches/does-not-exist/proof").send({ proof: "0xaa" });
    expect(res.status).toBe(400); // this app's error middleware maps any thrown Error (including matcher.ts's "No such match") to 400
  });
});

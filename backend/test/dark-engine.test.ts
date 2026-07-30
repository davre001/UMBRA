import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

function orderBody(overrides: Record<string, unknown>) {
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
    ...overrides,
  };
}

// Order submission and matching are real (real book, real Merkle-path
// assembly against the live Coston2 vault, real Poseidon2 commitments) —
// only proof generation is stubbed (UnavailableMatchProver, see prover.ts),
// so a genuine match here lands as "awaiting_proof", not "submitted".
describe("dark-engine routes", () => {
  it("rejects an order missing required fields", async () => {
    const res = await request(app).post("/api/dark-engine/orders").send({ commitment: "0x1" });
    expect(res.status).toBe(400);
  });

  it("rests an order with no compatible counterparty", async () => {
    const res = await request(app).post("/api/dark-engine/orders").send(orderBody({ commitment: "0xaa" }));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("resting");

    const list = await request(app).get("/api/dark-engine/orders");
    expect(list.body.orders.some((o: { commitment: string }) => o.commitment === "0xaa")).toBe(true);
  });

  it(
    "matches a compatible order against a real resting one and assembles real proof inputs",
    async () => {
      await request(app).post("/api/dark-engine/orders").send(
        orderBody({ commitment: "0xbb", leafIndex: 1, amountIn: "1000", assetIn: 0, assetOut: 1, minAmountOut: "900" })
      );
      const res = await request(app).post("/api/dark-engine/orders").send(
        orderBody({ commitment: "0xcc", leafIndex: 2, amountIn: "950", assetIn: 1, assetOut: 0, minAmountOut: "800" })
      );
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("matched");
      expect(res.body.matchStatus).toBe("awaiting_proof");

      const match = await request(app).get(`/api/dark-engine/matches/${res.body.matchId}`);
      expect(match.status).toBe(200);
      expect(match.body.status).toBe("awaiting_proof");
    },
    20_000
  );

  it("404s for an unknown match id", async () => {
    const res = await request(app).get("/api/dark-engine/matches/does-not-exist");
    expect(res.status).toBe(404);
  });
});

import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("prover routes", () => {
  it("generates a zk proof for the given inputs", async () => {
    const res = await request(app).post("/api/prover/prove").send({ action: "shield", amount: 100 });
    expect(res.status).toBe(200);
    expect(res.body.proof).toMatch(/^0x/);
    expect(res.body.provingTimeMs).toBeGreaterThan(0);
  });
});

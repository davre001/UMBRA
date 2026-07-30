import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

// Real on-chain writes against ComplianceRegistry on Coston2 via the
// backend's ATTESTER_ROLE key — needs PRIVATE_KEY set (see .env.example)
// and that key funded with C2FLR for gas.
describe("compliance routes", () => {
  it("rejects an invalid address", async () => {
    const res = await request(app).post("/api/compliance/screen").send({ address: "not-an-address" });
    expect(res.status).toBe(400);
  });

  it(
    "screens a real address on-chain and reflects it back on read",
    async () => {
      const address = "0xc25565154630860aE48B9C94c9704Bf04ee6808b";
      const screenRes = await request(app).post("/api/compliance/screen").send({ address });
      expect(screenRes.status).toBe(200);
      expect(screenRes.body.clear).toBe(true);
      expect(screenRes.body.txHash).toMatch(/^0x[0-9a-f]{64}$/);

      const readRes = await request(app).get(`/api/compliance/${address}`);
      expect(readRes.status).toBe(200);
      expect(readRes.body.clear).toBe(true);
    },
    30_000
  );
});

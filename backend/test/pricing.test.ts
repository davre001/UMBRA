import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

// Real FTSOv2 reads against live Coston2 — no mocking, matching the rest of
// this project's "verify against the real thing" discipline. Needs network
// access; asserts on plausibility (positive, finite) rather than exact
// values since real prices move.
describe("pricing routes", () => {
  it(
    "returns real USD prices for every supported asset",
    async () => {
      const res = await request(app).get("/api/pricing");
      expect(res.status).toBe(200);
      for (const symbol of ["WFLR", "FXRP", "USDT0"]) {
        expect(res.body[symbol].value).toBeGreaterThan(0);
        expect(Number.isFinite(res.body[symbol].value)).toBe(true);
      }
    },
    20_000
  );

  it(
    "returns a real midpoint rate for a known pair",
    async () => {
      const res = await request(app).get("/api/pricing/WFLR/USDT0");
      expect(res.status).toBe(200);
      expect(res.body.rate).toBeGreaterThan(0);
    },
    20_000
  );

  it("rejects an unsupported asset", async () => {
    const res = await request(app).get("/api/pricing/DOGE/USDT0");
    expect(res.status).toBe(400);
  });
});

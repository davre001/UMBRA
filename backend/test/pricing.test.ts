import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("pricing routes", () => {
  it("returns a midpoint rate for a known pair", async () => {
    const res = await request(app).get("/api/pricing/USDC/uWFLR");
    expect(res.status).toBe(200);
    expect(res.body.rate).toBe(5);
  });
});

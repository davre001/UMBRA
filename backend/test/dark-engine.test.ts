import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("dark-engine routes", () => {
  it("settles a swap intent and quotes a midpoint rate", async () => {
    const res = await request(app)
      .post("/api/swap/intent")
      .send({
        address: "0xswap",
        fromAsset: "USDC",
        toAsset: "uWFLR",
        fromAmount: 100,
        toAmount: 0,
        slippage: 0.1,
        mevProtection: "maximum",
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("settled");
    expect(res.body.toAmount).toBeGreaterThan(0);
  });
});

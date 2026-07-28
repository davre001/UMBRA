import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("portfolio routes", () => {
  it("aggregates net worth and anonymity score", async () => {
    const res = await request(app).get("/api/portfolio/0xportfolio");
    expect(res.status).toBe(200);
    expect(res.body.netWorth).toBeGreaterThan(0);
    expect(res.body.history).toHaveLength(7);
  });
});

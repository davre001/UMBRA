import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("stealth routes", () => {
  it("derives a one-time stealth address and payment link", async () => {
    const res = await request(app).post("/api/stealth/derive").send({ asset: "USDC", amount: "100" });
    expect(res.status).toBe(200);
    expect(res.body.stealthAddress).toMatch(/^st_flare_0x/);
    expect(res.body.paymentLink).toContain(res.body.stealthAddress);
  });

  it("resolves an ENS recipient to a stealth destination", async () => {
    const res = await request(app)
      .post("/api/stealth/resolve")
      .send({ recipientType: "ens", recipient: "vitalik.eth" });
    expect(res.status).toBe(200);
    expect(res.body.stealthAddress).toMatch(/^st_flare_0x/);
  });
});

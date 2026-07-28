import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("vault routes", () => {
  it("returns a starter balance for a new address", async () => {
    const res = await request(app).get("/api/vault/0xabc/balances");
    expect(res.status).toBe(200);
    expect(res.body.address).toBe("0xabc");
    expect(res.body.publicBalances.length).toBeGreaterThan(0);
  });

  it("shields funds from public into shielded balance", async () => {
    const res = await request(app)
      .post("/api/vault/shield")
      .send({ address: "0xshield", asset: "WFLR", amount: 100 });
    expect(res.status).toBe(200);
    expect(
      res.body.vault.shieldedBalances.find((b: any) => b.asset === "WFLR").balance
    ).toBe(100);
    expect(res.body.proof.proof).toMatch(/^0x/);
  });

  it("rejects withdrawal beyond shielded balance", async () => {
    const res = await request(app)
      .post("/api/vault/withdraw")
      .send({ address: "0xempty", asset: "WFLR", amount: 50, destination: "0xdest", gasless: false });
    expect(res.status).toBe(400);
  });
});

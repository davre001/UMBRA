import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("relayer routes", () => {
  it("relays a gasless transaction and returns a tx hash", async () => {
    const res = await request(app)
      .post("/api/relayer/relay")
      .send({ address: "0xabc", asset: "WFLR", amount: 10 });
    expect(res.status).toBe(200);
    expect(res.body.relayTxHash).toMatch(/^0x/);
  });
});

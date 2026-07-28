import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("compliance routes", () => {
  it("screens an address against sanction lists", async () => {
    const res = await request(app).post("/api/compliance/screen").send({ address: "0xpay" });
    expect(res.status).toBe(200);
    expect(res.body.clear).toBe(true);
    expect(res.body.screenedLists.length).toBeGreaterThan(0);
  });

  it("exports a masked viewing key", async () => {
    const res = await request(app).get("/api/compliance/viewing-key/0xabc123");
    expect(res.status).toBe(200);
    expect(res.body.viewingKey).toContain("umbra_vkey_flare_");
  });
});

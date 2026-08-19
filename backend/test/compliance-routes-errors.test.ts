import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import * as fdcClient from "../src/compliance/fdc.client";

/**
 * Covers compliance.routes.ts's two catch(err) { next(err) } branches —
 * never reached by compliance.test.ts's own real on-chain screening flow,
 * since a real screen/isScreened call against a healthy deployment simply
 * doesn't throw. Spies on the real fdc.client module (not a mock server)
 * to force the one failure mode these branches exist for, consistent with
 * this file's own real-module-under-test rather than a fully synthetic
 * double.
 */

const app = createApp();

describe("compliance routes / error branches", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POST /screen propagates a real screenAddress failure via next(err)", async () => {
    vi.spyOn(fdcClient, "screenAddress").mockRejectedValueOnce(new Error("RPC unavailable"));
    const res = await request(app).post("/api/compliance/screen").send({ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" });
    expect(res.status).toBe(400); // this app's error middleware maps a thrown Error to 400
  });

  it("GET /:address propagates a real isScreened failure via next(err)", async () => {
    vi.spyOn(fdcClient, "isScreened").mockRejectedValueOnce(new Error("RPC unavailable"));
    const res = await request(app).get("/api/compliance/0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(res.status).toBe(400);
  });
});

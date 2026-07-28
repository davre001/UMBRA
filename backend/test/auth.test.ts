import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();

describe("auth routes", () => {
  it("issues and verifies a passkey challenge", async () => {
    const challengeRes = await request(app).post("/api/auth/passkey/challenge").send();
    expect(challengeRes.status).toBe(200);
    const { challengeId } = challengeRes.body;

    const verifyRes = await request(app).post("/api/auth/passkey/verify").send({ challengeId });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.verified).toBe(true);
  });
});

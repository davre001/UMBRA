import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

// Static imports throughout (not vi.resetModules() per-test) — same reason
// as btc-withdrawal-routes.test.ts: `app` is built once at file load with
// its routes' own copy of store.ts/checkpoint.ts already captured, and
// resetting the module registry per-test would disconnect the test's own
// re-imported modules from the ones the already-built `app` actually uses.

const app = createApp();
const SECRET = process.env.BTC_DEPOSIT_INTERNAL_SECRET;

function buildSyntheticDepositTx(recipient: `0x${string}`, amountSats: bigint, vaultPubkeyHash: Buffer): Buffer {
  const version = Buffer.from([0x02, 0x00, 0x00, 0x00]);
  const inputCount = Buffer.from([0x01]);
  const prevTxid = Buffer.alloc(32, 0x11);
  const prevVout = Buffer.from([0x00, 0x00, 0x00, 0x00]);
  const scriptSigLen = Buffer.from([0x00]);
  const sequence = Buffer.from([0xff, 0xff, 0xff, 0xff]);
  const outputCount = Buffer.from([0x02]);
  const recipientBytes = Buffer.from(recipient.slice(2), "hex");
  const push32 = Buffer.concat([Buffer.alloc(12, 0), recipientBytes]);
  const out0Value = Buffer.alloc(8, 0);
  const out0Script = Buffer.concat([Buffer.from([0x6a, 0x20]), push32]);
  const out0ScriptLen = Buffer.from([out0Script.length]);
  const out1Value = Buffer.alloc(8);
  out1Value.writeBigUInt64LE(amountSats);
  const out1Script = Buffer.concat([Buffer.from([0x00, 0x14]), vaultPubkeyHash]);
  const out1ScriptLen = Buffer.from([out1Script.length]);
  const locktime = Buffer.alloc(4, 0);
  return Buffer.concat([
    version, inputCount, prevTxid, prevVout, scriptSigLen, sequence, outputCount,
    out0Value, out0ScriptLen, out0Script, out1Value, out1ScriptLen, out1Script, locktime,
  ]);
}

const VAULT_HASH = Buffer.from("1ec150307106f13a434437f03f10efc0c8fa45f3", "hex");
const RECIPIENT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;

function mockFetchOnce(body: string) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => body })));
}

describe("btc-deposit routes", () => {
  beforeAll(async () => {
    if (!SECRET) throw new Error("BTC_DEPOSIT_INTERNAL_SECRET must be set locally for this test file to run");
    // Sets checkpoint.ts's in-memory tracked height via the real route — a
    // fresh app has none set (unless BTC_CHECKPOINT_HEIGHT happened to be
    // in the environment), and POST /submit 503s without one.
    const res = await request(app).post("/api/btc-deposit/checkpoint").set("x-btc-deposit-secret", SECRET).send({ height: 1000 });
    expect(res.status).toBe(200);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("GET /checkpoint reports the currently tracked height, publicly", async () => {
    const res = await request(app).get("/api/btc-deposit/checkpoint");
    expect(res.status).toBe(200);
    expect(res.body.checkpointHeight).toBe(1000);
  });

  it("POST /checkpoint rejects a missing secret", async () => {
    const res = await request(app).post("/api/btc-deposit/checkpoint").send({ height: 1 });
    expect(res.status).toBe(401);
  });

  it("POST /checkpoint rejects a non-integer height", async () => {
    const res = await request(app).post("/api/btc-deposit/checkpoint").set("x-btc-deposit-secret", SECRET!).send({ height: "abc" });
    expect(res.status).toBe(400);
  });

  it("POST /checkpoint/extend rejects a missing secret", async () => {
    const res = await request(app).post("/api/btc-deposit/checkpoint/extend").send({});
    expect(res.status).toBe(401);
  });

  it("POST /checkpoint/extend rejects a malformed body", async () => {
    const res = await request(app)
      .post("/api/btc-deposit/checkpoint/extend")
      .set("x-btc-deposit-secret", SECRET!)
      .send({ proof: "not-hex", newCheckpointCommitment: "0x1", newHeight: 1 });
    expect(res.status).toBe(400);
  });

  it.skipIf(!!process.env.CI)(
    "POST /checkpoint/extend propagates a real on-chain revert for a garbage proof",
    async () => {
      const res = await request(app).post("/api/btc-deposit/checkpoint/extend").set("x-btc-deposit-secret", SECRET!).send({
        proof: "0xdeadbeef",
        newCheckpointCommitment: "0x" + "11".repeat(32),
        newHeight: 1006,
      });
      expect(res.status).toBe(400); // this app's error middleware maps a thrown Error to 400, not 500 — confirmed against the real response, not assumed
    },
    30_000
  );

  it("POST /submit rejects a malformed txid", async () => {
    const res = await request(app).post("/api/btc-deposit/submit").send({ txid: "not-a-real-txid" });
    expect(res.status).toBe(400);
  });

  it("POST /submit 404s when the tx can't be fetched from any signet source", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, text: async () => "" })));
    const res = await request(app).post("/api/btc-deposit/submit").send({ txid: "aa".repeat(32) });
    expect(res.status).toBe(404);
  });

  it("POST /submit accepts a template-matching tx and creates an awaiting_proof record", async () => {
    const tx = buildSyntheticDepositTx(RECIPIENT, 250000n, VAULT_HASH);
    mockFetchOnce(tx.toString("hex"));
    const res = await request(app).post("/api/btc-deposit/submit").send({ txid: "bb".repeat(32) });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("awaiting_proof");
    expect(res.body.recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(res.body.amountSats).toBe("250000");
  });

  it("POST /submit rejects a tx that doesn't match the fixed deposit template", async () => {
    const tx = buildSyntheticDepositTx(RECIPIENT, 250000n, VAULT_HASH);
    tx[46] = 1; // corrupt: claim 1 output instead of 2
    mockFetchOnce(tx.toString("hex"));
    const res = await request(app).post("/api/btc-deposit/submit").send({ txid: "cc".repeat(32) });
    expect(res.status).toBe(400); // TemplateMismatchError surfaces via the error middleware as a generic 400, not a dedicated branch
  });

  it("GET / lists only awaiting_proof deposits, commitments/status only", async () => {
    const tx = buildSyntheticDepositTx(RECIPIENT, 111111n, VAULT_HASH);
    mockFetchOnce(tx.toString("hex"));
    const submitRes = await request(app).post("/api/btc-deposit/submit").send({ txid: "dd".repeat(32) });

    const res = await request(app).get("/api/btc-deposit").query({ status: "awaiting_proof" });
    expect(res.status).toBe(200);
    expect(res.body.deposits.some((d: { id: string }) => d.id === submitRes.body.id)).toBe(true);
  });

  it("GET / rejects an unsupported status filter", async () => {
    const res = await request(app).get("/api/btc-deposit").query({ status: "minted" });
    expect(res.status).toBe(400);
  });

  it("GET /:id 404s for an unknown id", async () => {
    const res = await request(app).get("/api/btc-deposit/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("GET /:id/proof-inputs rejects a missing secret", async () => {
    const res = await request(app).get("/api/btc-deposit/whatever/proof-inputs");
    expect(res.status).toBe(401);
  });

  it("GET /:id/proof-inputs 404s for an unknown id", async () => {
    const res = await request(app).get("/api/btc-deposit/does-not-exist/proof-inputs").set("x-btc-deposit-secret", SECRET!);
    expect(res.status).toBe(404);
  });

  it("POST /:id/proof rejects a missing secret", async () => {
    const res = await request(app).post("/api/btc-deposit/whatever/proof").send({});
    expect(res.status).toBe(401);
  });

  it("POST /:id/proof rejects a malformed body", async () => {
    const res = await request(app)
      .post("/api/btc-deposit/whatever/proof")
      .set("x-btc-deposit-secret", SECRET!)
      .send({ proof: "not-hex" });
    expect(res.status).toBe(400);
  });

  it("POST /:id/proof 404s for an unknown id", async () => {
    const res = await request(app)
      .post("/api/btc-deposit/does-not-exist/proof")
      .set("x-btc-deposit-secret", SECRET!)
      .send({ proof: "0xaa", publicInputs: ["0x1", "0x2", "0x3", "0x4"] });
    expect(res.status).toBe(404);
  });

  it("POST /:id/proof marks a real awaiting_proof record proven", async () => {
    const tx = buildSyntheticDepositTx(RECIPIENT, 999n, VAULT_HASH);
    mockFetchOnce(tx.toString("hex"));
    const submitRes = await request(app).post("/api/btc-deposit/submit").send({ txid: "ee".repeat(32) });

    const res = await request(app)
      .post(`/api/btc-deposit/${submitRes.body.id}/proof`)
      .set("x-btc-deposit-secret", SECRET!)
      .send({ proof: "0xaa", publicInputs: ["0x1", "0x2", "0x3", "0x4"] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("proven");

    const record = await request(app).get(`/api/btc-deposit/${submitRes.body.id}`);
    expect(record.body.proof).toBe("0xaa");
  });

  it("POST /:id/fail rejects a missing secret", async () => {
    const res = await request(app).post("/api/btc-deposit/whatever/fail").send({});
    expect(res.status).toBe(401);
  });

  it("POST /:id/fail 404s for an unknown id", async () => {
    const res = await request(app).post("/api/btc-deposit/does-not-exist/fail").set("x-btc-deposit-secret", SECRET!).send({});
    expect(res.status).toBe(404);
  });

  it("POST /:id/fail marks a real record failed with the given reason", async () => {
    const tx = buildSyntheticDepositTx(RECIPIENT, 5555n, VAULT_HASH);
    mockFetchOnce(tx.toString("hex"));
    const submitRes = await request(app).post("/api/btc-deposit/submit").send({ txid: "ff".repeat(32) });

    const res = await request(app)
      .post(`/api/btc-deposit/${submitRes.body.id}/fail`)
      .set("x-btc-deposit-secret", SECRET!)
      .send({ reason: "checkpoint never caught up" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("failed");

    const record = await request(app).get(`/api/btc-deposit/${submitRes.body.id}`);
    expect(record.body.failureReason).toBe("checkpoint never caught up");
  });
});

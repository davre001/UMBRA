import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";
import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";
import { createApp } from "../src/app";
import * as store from "../src/btc-withdrawal/store";
import { buildWithdrawalPsbt } from "../src/btc-withdrawal/bitcoin-tx";
import type { BtcWithdrawalRequest } from "../src/btc-withdrawal/types";

// Deliberately NOT using vi.resetModules() here (unlike this repo's other
// btc-withdrawal test files) — `app` is created once, statically, at file
// load, with its routes' own copy of store.ts already captured via static
// import at that point. Resetting the module registry per-test would give
// the TEST its own fresh store instance, disconnected from the one the
// already-built `app`'s route handlers actually read/write — confirmed the
// hard way (every route returned 404 for records this file had just
// upserted, because they landed in a different store instance entirely).
// Static imports throughout instead, matching this repo's other route test
// files (compliance.test.ts etc.) — one shared module registry for
// everything in this file.

const ECPair = ECPairFactory(ecc);
const app = createApp();

const testWif = ECPair.makeRandom({ network: bitcoin.networks.testnet }).toWIF();
const reserveKeyPairs = [1, 2, 3].map(() => ECPair.makeRandom({ network: bitcoin.networks.testnet }));
const WITHDRAWAL_SECRET = "test-withdrawal-secret";

function makeRequest(nullifierHash: string): BtcWithdrawalRequest {
  return {
    nullifierHash,
    assetId: "999",
    destinationHash160: "aa".repeat(20),
    amountSats: "80000",
    status: "pending",
    requestedAtBlock: "100",
    observedAt: Date.now(),
  };
}

function mockFetchSequence(responses: { url: RegExp; body: unknown; ok?: boolean; text?: boolean }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const match = responses.find((r) => r.url.test(url));
      if (!match) throw new Error(`Unexpected fetch call: ${url}`);
      return {
        ok: match.ok ?? true,
        status: match.ok === false ? 500 : 200,
        json: async () => match.body,
        text: async () => (match.text ? (match.body as string) : JSON.stringify(match.body)),
      };
    })
  );
}

describe("btc-withdrawal routes / overdue", () => {
  beforeAll(() => {
    process.env.BTC_CUSTODIAN_WIF = testWif;
    process.env.BTC_WITHDRAWAL_INTERNAL_SECRET = WITHDRAWAL_SECRET;
    process.env.BTC_WITHDRAWAL_OVERDUE_MS = String(60 * 60 * 1000);
    reserveKeyPairs.forEach((k, i) => {
      process.env[`BTC_RESERVE_PUBKEY_${i + 1}`] = Buffer.from(k.publicKey).toString("hex");
    });
  });

  it("GET /overdue rejects a missing secret", async () => {
    const res = await request(app).get("/api/btc-withdrawal/overdue");
    expect(res.status).toBe(401);
  });

  it("GET /overdue lists stuck pending/awaiting_signatures records past the threshold", async () => {
    await store.upsertPending({ ...makeRequest("routes-overdue-1"), observedAt: Date.now() - 2 * 60 * 60 * 1000 });
    const res = await request(app).get("/api/btc-withdrawal/overdue").set("x-btc-withdrawal-secret", WITHDRAWAL_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.overdue.some((e: { nullifierHash: string }) => e.nullifierHash === "routes-overdue-1")).toBe(true);
  });
});

describe("btc-withdrawal routes / PSBT sign-and-collect", () => {
  beforeAll(() => {
    process.env.BTC_CUSTODIAN_WIF = testWif;
    process.env.BTC_WITHDRAWAL_INTERNAL_SECRET = WITHDRAWAL_SECRET;
    reserveKeyPairs.forEach((k, i) => {
      process.env[`BTC_RESERVE_PUBKEY_${i + 1}`] = Buffer.from(k.publicKey).toString("hex");
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function stageRecord(nullifierHash: string): Promise<string> {
    mockFetchSequence([
      { url: /\/address\/.+\/utxo/, body: [{ txid: "11".repeat(32), vout: 0, value: 200_000, status: { confirmed: true } }] },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } },
    ]);
    await store.upsertPending(makeRequest(nullifierHash));
    const { psbt } = await buildWithdrawalPsbt("aa".repeat(20), BigInt(80_000));
    await store.markAwaitingSignatures(nullifierHash, psbt);
    return psbt;
  }

  it("GET /psbt rejects a missing secret", async () => {
    const res = await request(app).get("/api/btc-withdrawal/whatever/psbt");
    expect(res.status).toBe(401);
  });

  it("GET /psbt returns 404 for an unknown nullifierHash", async () => {
    const res = await request(app).get("/api/btc-withdrawal/unknown-hash/psbt").set("x-btc-withdrawal-secret", WITHDRAWAL_SECRET);
    expect(res.status).toBe(404);
  });

  it("GET /psbt returns 409 for a record that isn't awaiting_signatures", async () => {
    await store.upsertPending(makeRequest("routes-pending-1"));
    const res = await request(app).get("/api/btc-withdrawal/routes-pending-1/psbt").set("x-btc-withdrawal-secret", WITHDRAWAL_SECRET);
    expect(res.status).toBe(409);
  });

  it("GET /psbt returns the staged PSBT once awaiting_signatures", async () => {
    const psbt = await stageRecord("routes-staged-1");
    const res = await request(app).get("/api/btc-withdrawal/routes-staged-1/psbt").set("x-btc-withdrawal-secret", WITHDRAWAL_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("awaiting_signatures");
    expect(res.body.psbt).toBe(psbt);
  });

  it("POST /psbt rejects a missing secret", async () => {
    const res = await request(app).post("/api/btc-withdrawal/whatever/psbt").send({ psbt: "x" });
    expect(res.status).toBe(401);
  });

  it("POST /psbt with 1 of 3 signatures stays awaiting_signatures and reports the count", async () => {
    const psbt = await stageRecord("routes-sign-1");
    const psbtObj = bitcoin.Psbt.fromBase64(psbt, { network: bitcoin.networks.testnet });
    psbtObj.signAllInputs(reserveKeyPairs[0]);

    mockFetchSequence([]); // must not broadcast yet — only 1 of 2 required signatures present
    const res = await request(app)
      .post("/api/btc-withdrawal/routes-sign-1/psbt")
      .set("x-btc-withdrawal-secret", WITHDRAWAL_SECRET)
      .send({ psbt: psbtObj.toBase64() });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("awaiting_signatures");
    expect(res.body.signatureCounts).toEqual([1]);
    expect(store.getRecord("routes-sign-1")?.status).toBe("awaiting_signatures");
  });

  it("POST /psbt auto-finalizes and broadcasts once the 2nd of 3 signers submits, combining with the 1st signer's already-stored signature", async () => {
    const psbt = await stageRecord("routes-sign-2");

    // Signer 1 submits first (separate request, matching real independent
    // signer behavior — no coordination between them).
    const psbt1 = bitcoin.Psbt.fromBase64(psbt, { network: bitcoin.networks.testnet });
    psbt1.signAllInputs(reserveKeyPairs[0]);
    mockFetchSequence([]);
    const res1 = await request(app)
      .post("/api/btc-withdrawal/routes-sign-2/psbt")
      .set("x-btc-withdrawal-secret", WITHDRAWAL_SECRET)
      .send({ psbt: psbt1.toBase64() });
    expect(res1.body.status).toBe("awaiting_signatures");

    // Signer 2 signs the ORIGINAL unsigned PSBT independently (not signer
    // 1's already-partially-signed one) — the backend's own Psbt.combine
    // is what merges the two, same as real signers who never see each
    // other's work.
    const psbt2 = bitcoin.Psbt.fromBase64(psbt, { network: bitcoin.networks.testnet });
    psbt2.signAllInputs(reserveKeyPairs[1]);
    mockFetchSequence([{ url: /\/tx$/, body: "deadbeef".repeat(8), text: true }]);
    const res2 = await request(app)
      .post("/api/btc-withdrawal/routes-sign-2/psbt")
      .set("x-btc-withdrawal-secret", WITHDRAWAL_SECRET)
      .send({ psbt: psbt2.toBase64() });

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe("broadcast");
    expect(res2.body.payoutTxid).toBe("deadbeef".repeat(8));

    const record = store.getRecord("routes-sign-2");
    expect(record?.status).toBe("broadcast");
    expect(record?.payoutTxid).toBe("deadbeef".repeat(8));
    expect(record?.psbt).toBeUndefined();
  });

  it("POST /psbt propagates a real parse failure (malformed base64) via next(err)", async () => {
    await stageRecord("routes-malformed-1");
    mockFetchSequence([]); // must never reach a broadcast call
    const res = await request(app)
      .post("/api/btc-withdrawal/routes-malformed-1/psbt")
      .set("x-btc-withdrawal-secret", WITHDRAWAL_SECRET)
      .send({ psbt: "not-a-real-psbt-at-all" });
    expect(res.status).toBe(400); // this app's error middleware maps a thrown Error (bitcoin.Psbt.fromBase64's own parse error) to 400
  });

  it("GET /:nullifierHash returns the full record for a known withdrawal, no secret required", async () => {
    await store.upsertPending(makeRequest("routes-get-plain"));
    const res = await request(app).get("/api/btc-withdrawal/routes-get-plain");
    expect(res.status).toBe(200);
    expect(res.body.nullifierHash).toBe("routes-get-plain");
    expect(res.body.status).toBe("pending");
  });

  it("GET /:nullifierHash 404s for an unknown withdrawal", async () => {
    const res = await request(app).get("/api/btc-withdrawal/does-not-exist");
    expect(res.status).toBe(404);
  });
});

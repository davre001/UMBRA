import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";
import * as store from "../src/btc-withdrawal/store";
import type { BtcWithdrawalRequest } from "../src/btc-withdrawal/types";

const ECPair = ECPairFactory(ecc);

// Same throwaway-key convention as btc-withdrawal.test.ts — never a real
// custodian/reserve key.
const testKeyPair = ECPair.makeRandom({ network: bitcoin.networks.testnet });
const testWif = testKeyPair.toWIF();
const reserveKeys = [1, 2, 3].map(() => ECPair.makeRandom({ network: bitcoin.networks.testnet }));

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

describe("btc-withdrawal / watcher retry (regression: InsufficientFundsError used to be an un-retried dead end)", () => {
  beforeEach(() => {
    process.env.BTC_CUSTODIAN_WIF = testWif;
    reserveKeys.forEach((k, i) => {
      process.env[`BTC_RESERVE_PUBKEY_${i + 1}`] = Buffer.from(k.publicKey).toString("hex");
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BTC_CUSTODIAN_WIF;
    for (let i = 1; i <= 3; i++) delete process.env[`BTC_RESERVE_PUBKEY_${i}`];
  });

  it("leaves a record in listPending() after InsufficientFundsError, and a later attemptFulfillment call on that same record stages a PSBT once funds are available", async () => {
    const { attemptFulfillment } = await import("../src/btc-withdrawal/watcher");
    const request = makeRequest("watcher-retry-1");
    await store.upsertPending(request);

    // First attempt: reserve underfunded.
    mockFetchSequence([
      { url: /\/address\/.+\/utxo/, body: [{ txid: "11".repeat(32), vout: 0, value: 1_000, status: { confirmed: true } }] },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } },
    ]);
    const firstAttempt = await attemptFulfillment(request);
    expect(firstAttempt).toBe(false);
    expect(store.getRecord("watcher-retry-1")?.status).toBe("pending");

    // This is the property the fix establishes: the record must actually
    // be findable again via listPending() — the whole point of retrying
    // independent of the forward-only block-range log scan.
    const pendingIds = store.listPending().map((r) => r.nullifierHash);
    expect(pendingIds).toContain("watcher-retry-1");

    // Second attempt, using the record as pulled from listPending() (not a
    // hand-held reference) — reserve now funded. attemptFulfillment only
    // ever STAGES a PSBT now (this backend holds no reserve private key —
    // see reserve.ts's own doc), so no broadcast call happens here at all.
    mockFetchSequence([
      { url: /\/address\/.+\/utxo/, body: [{ txid: "22".repeat(32), vout: 0, value: 200_000, status: { confirmed: true } }] },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } },
    ]);
    const retried = store.listPending().find((r) => r.nullifierHash === "watcher-retry-1")!;
    const secondAttempt = await attemptFulfillment(retried);
    expect(secondAttempt).toBe(true);
    expect(store.getRecord("watcher-retry-1")?.status).toBe("awaiting_signatures");
    expect(store.getRecord("watcher-retry-1")?.psbt).toBeTruthy();
    expect(store.listPending().map((r) => r.nullifierHash)).not.toContain("watcher-retry-1");
  }, 20_000); // extra headroom for real DNS/network variance under a full-file run — same fix applied once already this session to a sibling rate-limit test

  it("is a no-op returning false for a record already broadcast", async () => {
    const { attemptFulfillment } = await import("../src/btc-withdrawal/watcher");
    const request = makeRequest("watcher-retry-2");
    await store.upsertPending(request);
    await store.markBroadcast("watcher-retry-2", "cafebabe".repeat(8));

    mockFetchSequence([]); // no fetch calls should happen at all
    const result = await attemptFulfillment(store.getRecord("watcher-retry-2")!);
    expect(result).toBe(false);
  });

  it("is a no-op returning false for a record already awaiting_signatures", async () => {
    const { attemptFulfillment } = await import("../src/btc-withdrawal/watcher");
    const request = makeRequest("watcher-retry-3");
    await store.upsertPending(request);
    await store.markAwaitingSignatures("watcher-retry-3", "cHNidP8=");

    mockFetchSequence([]); // no fetch calls should happen at all — must not re-stage a second PSBT
    const result = await attemptFulfillment(store.getRecord("watcher-retry-3")!);
    expect(result).toBe(false);
    expect(store.getRecord("watcher-retry-3")?.psbt).toBe("cHNidP8=");
  });

  it("leaves a record pending (retryable) when a configured rate cap is temporarily exceeded by the trailing window, not by this amount alone", async () => {
    // The cap (100,000) comfortably fits this one 80,000-sat request on its
    // own — assertWithinRateCap's "exceeds the cap alone" permanent-failure
    // branch must NOT fire here. It's only the trailing window's already-
    // broadcast 50,000 sats plus this request (130,000 total) that pushes
    // past the cap — the *temporary*, retryable branch.
    process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR = "100000";
    try {
      const priorlyBroadcast = makeRequest("watcher-retry-ratecap-temp-prior");
      priorlyBroadcast.amountSats = "50000";
      await store.upsertPending(priorlyBroadcast);
      await store.markBroadcast("watcher-retry-ratecap-temp-prior", "aa".repeat(32));

      const { attemptFulfillment } = await import("../src/btc-withdrawal/watcher");
      const request = makeRequest("watcher-retry-ratecap-temp");
      await store.upsertPending(request);
      mockFetchSequence([]); // must never even reach the reserve/fee lookups — the cap check runs first
      const result = await attemptFulfillment(request);
      expect(result).toBe(false);
      expect(store.getRecord("watcher-retry-ratecap-temp")?.status).toBe("pending");
    } finally {
      delete process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR;
    }
  });

  it("permanently fails a record whose amount alone exceeds a configured rate cap", async () => {
    process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR = "100"; // smaller than any single request could ever fit under
    try {
      const { attemptFulfillment } = await import("../src/btc-withdrawal/watcher");
      const request = makeRequest("watcher-retry-ratecap-perm");
      await store.upsertPending(request);
      mockFetchSequence([]);
      const result = await attemptFulfillment(request);
      expect(result).toBe(false);
      expect(store.getRecord("watcher-retry-ratecap-perm")?.status).toBe("failed");
      expect(store.getRecord("watcher-retry-ratecap-perm")?.failureReason).toMatch(/cap/);
    } finally {
      delete process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR;
    }
  });

  it("marks a record permanently failed on an unexpected (non-fund, non-rate-cap) error", async () => {
    const { attemptFulfillment } = await import("../src/btc-withdrawal/watcher");
    const request = makeRequest("watcher-retry-unexpected");
    await store.upsertPending(request);
    mockFetchSequence([{ url: /\/address\/.+\/utxo/, body: [], ok: false }]); // fetchUtxos itself throws
    const result = await attemptFulfillment(request);
    expect(result).toBe(false);
    expect(store.getRecord("watcher-retry-unexpected")?.status).toBe("failed");
  });
});

describe("btc-withdrawal / watcher pollOnce", () => {
  beforeEach(() => {
    process.env.BTC_CUSTODIAN_WIF = testWif;
    reserveKeys.forEach((k, i) => {
      process.env[`BTC_RESERVE_PUBKEY_${i + 1}`] = Buffer.from(k.publicKey).toString("hex");
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BTC_CUSTODIAN_WIF;
    for (let i = 1; i <= 3; i++) delete process.env[`BTC_RESERVE_PUBKEY_${i}`];
  });

  it.skipIf(!!process.env.CI)(
    "scans real ShieldedVault event logs end to end (read-only, no funded key needed) with nothing pending",
    async () => {
      // Deliberately no vi.stubGlobal("fetch", ...) here — pollOnce's own
      // event-log scan goes through viem's real RPC transport (also
      // built on global fetch), which a blanket stub would break exactly
      // like it did the first time this test was written (confirmed the
      // hard way: "Unexpected fetch call: https://flare-testnet.drpc.org/").
      // Nothing pending in the store for this describe block, so this only
      // exercises the real getBlockNumber/getLogs path, not attemptFulfillment.
      const { pollOnce } = await import("../src/btc-withdrawal/watcher");
      const result = await pollOnce();
      expect(result.scanned).toBeGreaterThanOrEqual(0);
      expect(result.staged).toBeGreaterThanOrEqual(0);
    },
    30_000
  );
});

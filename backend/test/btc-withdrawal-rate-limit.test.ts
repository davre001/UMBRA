import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";
import type { BtcWithdrawalRequest } from "../src/btc-withdrawal/types";

const ECPair = ECPairFactory(ecc);
const testKeyPair = ECPair.makeRandom({ network: bitcoin.networks.testnet });
const testWif = testKeyPair.toWIF();
const reserveKeys = [1, 2, 3].map(() => ECPair.makeRandom({ network: bitcoin.networks.testnet }));

function makeRequest(nullifierHash: string, amountSats: string): BtcWithdrawalRequest {
  return {
    nullifierHash,
    assetId: "999",
    destinationHash160: "aa".repeat(20),
    amountSats,
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

const AMPLE_UTXO_RESPONSE = { url: /\/address\/.+\/utxo/, body: [{ txid: "11".repeat(32), vout: 0, value: 10_000_000, status: { confirmed: true } }] };
const FEE_RESPONSE = { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } };

// Every test gets a fresh module registry (fresh in-memory store.ts `records`
// Map) — rate-limit.ts's caps sum across the ENTIRE store, so leaking state
// between tests here (unlike btc-withdrawal-watcher.test.ts's own tests,
// which only ever check one record at a time and never cared about this)
// would make one test's broadcasts silently count toward another's cap
// check. `store` itself is re-imported fresh inside each test, after the
// reset, so it's the same instance rate-limit.ts/watcher.ts pick up when
// they're dynamically imported afterward.
describe("btc-withdrawal / rate-limit", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.BTC_CUSTODIAN_WIF = testWif;
    reserveKeys.forEach((k, i) => {
      process.env[`BTC_RESERVE_PUBKEY_${i + 1}`] = Buffer.from(k.publicKey).toString("hex");
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BTC_CUSTODIAN_WIF;
    delete process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR;
    delete process.env.BTC_WITHDRAWAL_MAX_SATS_PER_DAY;
    for (let i = 1; i <= 3; i++) delete process.env[`BTC_RESERVE_PUBKEY_${i}`];
  });

  describe("assertWithinRateCap", () => {
    it("is a no-op when no caps are configured", async () => {
      const { assertWithinRateCap } = await import("../src/btc-withdrawal/rate-limit");
      expect(() => assertWithinRateCap(BigInt(1_000_000_000))).not.toThrow();
    });

    it("allows a withdrawal that fits within the configured hourly cap", async () => {
      process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR = "100000";
      const { assertWithinRateCap } = await import("../src/btc-withdrawal/rate-limit");
      expect(() => assertWithinRateCap(BigInt(50_000))).not.toThrow();
    });

    it("throws RateCapPermanentlyExceededError for a single withdrawal larger than the cap itself", async () => {
      process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR = "100000";
      const { assertWithinRateCap, RateCapPermanentlyExceededError } = await import("../src/btc-withdrawal/rate-limit");
      expect(() => assertWithinRateCap(BigInt(200_000))).toThrow(RateCapPermanentlyExceededError);
    });

    it("throws RateCapTemporarilyExceededError once prior broadcasts in the window already used up the cap", async () => {
      process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR = "100000";
      const store = await import("../src/btc-withdrawal/store");
      await store.upsertPending(makeRequest("rl-already-spent", "80000"));
      await store.markBroadcast("rl-already-spent", "aa".repeat(32));

      const { assertWithinRateCap, RateCapTemporarilyExceededError } = await import("../src/btc-withdrawal/rate-limit");
      // 80,000 already spent this hour + a 30,000 request > 100,000 cap.
      expect(() => assertWithinRateCap(BigInt(30_000))).toThrow(RateCapTemporarilyExceededError);
    });

    it("does not count a broadcast outside the trailing window", async () => {
      process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR = "100000";
      const store = await import("../src/btc-withdrawal/store");
      await store.upsertPending(makeRequest("rl-old-broadcast", "80000"));
      await store.markBroadcast("rl-old-broadcast", "bb".repeat(32));
      // Backdate the broadcast well outside the 1h window.
      store.getRecord("rl-old-broadcast")!.broadcastAt = Date.now() - 2 * 60 * 60 * 1000;

      const { assertWithinRateCap } = await import("../src/btc-withdrawal/rate-limit");
      expect(() => assertWithinRateCap(BigInt(50_000))).not.toThrow();
    });

    it("evaluates hourly and daily caps independently — a daily cap can block even when the hourly cap has room", async () => {
      process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR = "1000000";
      process.env.BTC_WITHDRAWAL_MAX_SATS_PER_DAY = "100000";
      const store = await import("../src/btc-withdrawal/store");
      await store.upsertPending(makeRequest("rl-daily-spent", "90000"));
      await store.markBroadcast("rl-daily-spent", "cc".repeat(32));

      const { assertWithinRateCap, RateCapTemporarilyExceededError } = await import("../src/btc-withdrawal/rate-limit");
      expect(() => assertWithinRateCap(BigInt(20_000))).toThrow(RateCapTemporarilyExceededError);
    });

    it("rejects a non-positive cap value with a clear error", async () => {
      process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR = "0";
      const { assertWithinRateCap } = await import("../src/btc-withdrawal/rate-limit");
      expect(() => assertWithinRateCap(BigInt(1))).toThrow(/must be a positive integer/);
    });
  });

  describe("watcher integration", () => {
    it(
      "leaves a record pending (not failed) when the rate cap is temporarily exceeded, and stages a PSBT once the cap is lifted",
      async () => {
        process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR = "90000";
        const store = await import("../src/btc-withdrawal/store");
        // An earlier, unrelated broadcast already used up most of the hourly
        // window — the request below (60,000 sats) fits under the cap on its
        // own, but not on top of the 50,000 already spent this hour.
        await store.upsertPending(makeRequest("rl-watcher-0-prior", "50000"));
        await store.markBroadcast("rl-watcher-0-prior", "ee".repeat(32));

        const { attemptFulfillment } = await import("../src/btc-withdrawal/watcher");
        const request = makeRequest("rl-watcher-1", "60000");
        await store.upsertPending(request);

        mockFetchSequence([]); // rate cap should reject before any network call happens
        const firstAttempt = await attemptFulfillment(request);
        expect(firstAttempt).toBe(false);
        expect(store.getRecord("rl-watcher-1")?.status).toBe("pending");
        expect(store.listPending().map((r) => r.nullifierHash)).toContain("rl-watcher-1");

        // Cap lifted (e.g. operator raised it) — same record now stages a
        // PSBT. attemptFulfillment never broadcasts directly anymore (this
        // backend holds no reserve private key — see reserve.ts's own doc).
        delete process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR;
        mockFetchSequence([AMPLE_UTXO_RESPONSE, FEE_RESPONSE]);
        const retried = store.listPending().find((r) => r.nullifierHash === "rl-watcher-1")!;
        const secondAttempt = await attemptFulfillment(retried);
        expect(secondAttempt).toBe(true);
        expect(store.getRecord("rl-watcher-1")?.status).toBe("awaiting_signatures");
      },
      15_000
    );

    it("marks a record permanently failed (not pending) when its amount alone exceeds the configured cap", async () => {
      process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR = "50000";
      const store = await import("../src/btc-withdrawal/store");
      const { attemptFulfillment } = await import("../src/btc-withdrawal/watcher");
      const request = makeRequest("rl-watcher-2", "999999");
      await store.upsertPending(request);

      mockFetchSequence([]);
      const result = await attemptFulfillment(request);
      expect(result).toBe(false);
      expect(store.getRecord("rl-watcher-2")?.status).toBe("failed");
      expect(store.getRecord("rl-watcher-2")?.failureReason).toMatch(/exceeds it and can never be paid/);
    });
  });

  describe("getRateCapStatus", () => {
    it("reports null caps and zero spend when unconfigured", async () => {
      const { getRateCapStatus } = await import("../src/btc-withdrawal/rate-limit");
      const status = getRateCapStatus();
      expect(status.maxSatsPerHour).toBeNull();
      expect(status.maxSatsPerDay).toBeNull();
      expect(status.spentSatsLastHour).toBe("0");
    });

    it("reports configured caps and real trailing-window spend", async () => {
      process.env.BTC_WITHDRAWAL_MAX_SATS_PER_HOUR = "500000";
      const store = await import("../src/btc-withdrawal/store");
      await store.upsertPending(makeRequest("rl-status-1", "123456"));
      await store.markBroadcast("rl-status-1", "dd".repeat(32));

      const { getRateCapStatus } = await import("../src/btc-withdrawal/rate-limit");
      const status = getRateCapStatus();
      expect(status.maxSatsPerHour).toBe("500000");
      expect(status.spentSatsLastHour).toBe("123456");
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";
import type { BtcWithdrawalRequest } from "../src/btc-withdrawal/types";

const ECPair = ECPairFactory(ecc);
const custodianWif = ECPair.makeRandom({ network: bitcoin.networks.testnet }).toWIF();
const reserveKeys = [1, 2, 3].map(() => ECPair.makeRandom({ network: bitcoin.networks.testnet }));

function makeRequest(nullifierHash: string, status: BtcWithdrawalRequest["status"], observedAt: number): BtcWithdrawalRequest {
  return {
    nullifierHash,
    assetId: "999",
    destinationHash160: "aa".repeat(20),
    amountSats: "12345",
    status,
    requestedAtBlock: "100",
    observedAt,
  };
}

const ONE_HOUR_MS = 60 * 60 * 1000;

describe("btc-withdrawal / overdue", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.BTC_WITHDRAWAL_OVERDUE_MS;
  });
  afterEach(() => {
    delete process.env.BTC_WITHDRAWAL_OVERDUE_MS;
  });

  it("defaults the threshold to 6 hours when unset", async () => {
    const { getOverdueThresholdMs } = await import("../src/btc-withdrawal/overdue");
    expect(getOverdueThresholdMs()).toBe(6 * ONE_HOUR_MS);
  });

  it("reads a configured threshold from BTC_WITHDRAWAL_OVERDUE_MS", async () => {
    process.env.BTC_WITHDRAWAL_OVERDUE_MS = "1800000";
    const { getOverdueThresholdMs } = await import("../src/btc-withdrawal/overdue");
    expect(getOverdueThresholdMs()).toBe(1_800_000);
  });

  it("rejects a non-positive threshold", async () => {
    process.env.BTC_WITHDRAWAL_OVERDUE_MS = "0";
    const { getOverdueThresholdMs } = await import("../src/btc-withdrawal/overdue");
    expect(() => getOverdueThresholdMs()).toThrow(/positive/);
  });

  it("flags pending/awaiting_signatures records past the threshold, and only those", async () => {
    process.env.BTC_WITHDRAWAL_OVERDUE_MS = String(ONE_HOUR_MS);
    const store = await import("../src/btc-withdrawal/store");
    const now = Date.now();

    await store.upsertPending(makeRequest("overdue-pending", "pending", now - 2 * ONE_HOUR_MS)); // overdue
    await store.upsertPending(makeRequest("overdue-awaiting", "awaiting_signatures", now - 3 * ONE_HOUR_MS)); // overdue
    await store.upsertPending(makeRequest("overdue-fresh", "pending", now - 5 * 60 * 1000)); // too recent
    await store.upsertPending(makeRequest("overdue-broadcast", "broadcast", now - 10 * ONE_HOUR_MS)); // done, excluded
    await store.upsertPending(makeRequest("overdue-failed", "failed", now - 10 * ONE_HOUR_MS)); // separately tracked, excluded

    const { listOverdue } = await import("../src/btc-withdrawal/overdue");
    const overdue = listOverdue(now);
    const hashes = overdue.map((e) => e.nullifierHash).sort();
    expect(hashes).toEqual(["overdue-awaiting", "overdue-pending"].sort());

    const pendingEntry = overdue.find((e) => e.nullifierHash === "overdue-pending")!;
    expect(pendingEntry.ageMs).toBe(2 * ONE_HOUR_MS);
    expect(pendingEntry.status).toBe("pending");
    expect(pendingEntry.amountSats).toBe("12345");
  });

  it("computeSolvency surfaces overdueCount and oldestOverdueMs", async () => {
    process.env.BTC_WITHDRAWAL_OVERDUE_MS = String(ONE_HOUR_MS);
    process.env.BTC_CUSTODIAN_WIF = custodianWif;
    reserveKeys.forEach((k, i) => (process.env[`BTC_RESERVE_PUBKEY_${i + 1}`] = Buffer.from(k.publicKey).toString("hex")));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }))
    );

    const store = await import("../src/btc-withdrawal/store");
    const now = Date.now();
    await store.upsertPending(makeRequest("solv-overdue-1", "pending", now - 5 * ONE_HOUR_MS));
    await store.upsertPending(makeRequest("solv-overdue-2", "awaiting_signatures", now - 2 * ONE_HOUR_MS));

    const { computeSolvency } = await import("../src/btc-withdrawal/solvency");
    const report = await computeSolvency();
    expect(report.overdueCount).toBe(2);
    // computeSolvency() takes its own Date.now() internally (doesn't accept
    // an injected `now` the way listOverdue() does for exact-boundary
    // tests above) — a little real wall-clock time elapses between
    // capturing `now` here and that internal call, so assert a tolerance
    // instead of exact equality.
    expect(report.oldestOverdueMs).toBeGreaterThanOrEqual(5 * ONE_HOUR_MS);
    expect(report.oldestOverdueMs!).toBeLessThan(5 * ONE_HOUR_MS + 5000);

    vi.unstubAllGlobals();
    delete process.env.BTC_CUSTODIAN_WIF;
    for (let i = 1; i <= 3; i++) delete process.env[`BTC_RESERVE_PUBKEY_${i}`];
  });
});

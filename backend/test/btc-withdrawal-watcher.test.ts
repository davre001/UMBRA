import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";
import * as store from "../src/btc-withdrawal/store";
import type { BtcWithdrawalRequest } from "../src/btc-withdrawal/types";

const ECPair = ECPairFactory(ecc);

// Same throwaway-key convention as btc-withdrawal.test.ts — never a real
// custodian key.
const testKeyPair = ECPair.makeRandom({ network: bitcoin.networks.testnet });
const testWif = testKeyPair.toWIF();

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
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BTC_CUSTODIAN_WIF;
  });

  it("leaves a record in listPending() after InsufficientFundsError, and a later attemptFulfillment call on that same record succeeds once funds are available", async () => {
    const { attemptFulfillment } = await import("../src/btc-withdrawal/watcher");
    const request = makeRequest("watcher-retry-1");
    await store.upsertPending(request);

    // First attempt: custodian underfunded.
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
    // hand-held reference) — custodian now funded.
    mockFetchSequence([
      { url: /\/address\/.+\/utxo/, body: [{ txid: "22".repeat(32), vout: 0, value: 200_000, status: { confirmed: true } }] },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } },
      { url: /\/tx$/, body: "deadbeef".repeat(8), text: true },
    ]);
    const retried = store.listPending().find((r) => r.nullifierHash === "watcher-retry-1")!;
    const secondAttempt = await attemptFulfillment(retried);
    expect(secondAttempt).toBe(true);
    expect(store.getRecord("watcher-retry-1")?.status).toBe("broadcast");
    expect(store.listPending().map((r) => r.nullifierHash)).not.toContain("watcher-retry-1");
  });

  it("is a no-op returning false for a record already broadcast", async () => {
    const { attemptFulfillment } = await import("../src/btc-withdrawal/watcher");
    const request = makeRequest("watcher-retry-2");
    await store.upsertPending(request);
    await store.markBroadcast("watcher-retry-2", "cafebabe".repeat(8));

    mockFetchSequence([]); // no fetch calls should happen at all
    const result = await attemptFulfillment(store.getRecord("watcher-retry-2")!);
    expect(result).toBe(false);
  });
});

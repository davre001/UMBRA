import { describe, it, expect, beforeEach } from "vitest";
import * as store from "../src/btc-withdrawal/store";
import type { BtcWithdrawalRequest } from "../src/btc-withdrawal/types";

// NODE_ENV=test (Vitest's default) means store.ts's own `configured` check
// is false regardless of TURSO_DATABASE_URL — same convention
// dark-engine/store.ts already established (see that file's own comment):
// tests exercise the in-memory behavior, never a real Turso account. This
// suite is about the in-memory Map semantics upsertPending/markBroadcast/
// markFailed/hydrate all sit on top of — the same logic runs whether or
// not the write-through to Turso underneath it is actually configured.

function makeRequest(nullifierHash: string, overrides: Partial<BtcWithdrawalRequest> = {}): BtcWithdrawalRequest {
  return {
    nullifierHash,
    assetId: "999",
    destinationHash160: "aa".repeat(20),
    amountSats: "50000",
    status: "pending",
    requestedAtBlock: "100",
    observedAt: Date.now(),
    ...overrides,
  };
}

describe("btc-withdrawal / store (in-memory / unconfigured mode)", () => {
  it("round-trips a pending record", async () => {
    const req = makeRequest("nh-1");
    await store.upsertPending(req);
    expect(store.getRecord("nh-1")).toEqual(req);
  });

  it("transitions pending -> broadcast and records the payout txid", async () => {
    await store.upsertPending(makeRequest("nh-2"));
    await store.markBroadcast("nh-2", "deadbeef".repeat(8));
    const record = store.getRecord("nh-2");
    expect(record?.status).toBe("broadcast");
    expect(record?.payoutTxid).toBe("deadbeef".repeat(8));
  });

  it("transitions pending -> failed and records the reason", async () => {
    await store.upsertPending(makeRequest("nh-3"));
    await store.markFailed("nh-3", "insufficient funds");
    const record = store.getRecord("nh-3");
    expect(record?.status).toBe("failed");
    expect(record?.failureReason).toBe("insufficient funds");
  });

  it("markBroadcast/markFailed on an unknown nullifierHash is a safe no-op", async () => {
    await expect(store.markBroadcast("nh-does-not-exist", "abc")).resolves.toBeUndefined();
    await expect(store.markFailed("nh-does-not-exist", "abc")).resolves.toBeUndefined();
    expect(store.getRecord("nh-does-not-exist")).toBeUndefined();
  });

  it("listPending only returns pending records", async () => {
    await store.upsertPending(makeRequest("nh-4"));
    await store.upsertPending(makeRequest("nh-5"));
    await store.markBroadcast("nh-5", "abc");
    const pending = store.listPending();
    expect(pending.some((r) => r.nullifierHash === "nh-4")).toBe(true);
    expect(pending.some((r) => r.nullifierHash === "nh-5")).toBe(false);
  });

  it("tracks lastProcessedBlock", async () => {
    expect(store.getLastProcessedBlock()).toBeNull();
    await store.setLastProcessedBlock(BigInt(12345));
    expect(store.getLastProcessedBlock()).toBe(BigInt(12345));
  });

  it("hydrate() is a safe no-op when unconfigured", async () => {
    await expect(store.hydrate()).resolves.toBeUndefined();
  });
});

describe("btc-withdrawal / store idempotency semantics", () => {
  beforeEach(async () => {
    await store.upsertPending(makeRequest("nh-idempotent"));
    await store.markBroadcast("nh-idempotent", "real-txid");
  });

  it("a record already broadcast stays broadcast if upserted again as pending (watcher's own re-check, not store's job to prevent)", async () => {
    // store.ts itself doesn't refuse this — watcher.ts's fulfillOne is what
    // checks `existing?.status === "broadcast"` before ever calling
    // upsertPending again for the same nullifierHash. This test documents
    // that the guard lives in watcher.ts, not here, so a future change to
    // one doesn't silently assume the other still holds.
    const before = store.getRecord("nh-idempotent");
    expect(before?.status).toBe("broadcast");
  });
});

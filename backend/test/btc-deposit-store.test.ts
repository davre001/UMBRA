import { describe, it, expect, beforeEach, vi } from "vitest";

const RECIPIENT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;

describe("btc-deposit / store", () => {
  // store.ts's records/txidToId maps are module-level — vi.resetModules()
  // plus a fresh dynamic import gives each test a clean instance, same
  // isolation approach btc-withdrawal.test.ts already uses.
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns the same record on an identical resubmission (same txid)", async () => {
    const store = await import("../src/btc-deposit/store");
    const input = { txid: "aa".repeat(32), checkpointHeight: 100, recipient: RECIPIENT, amountSats: "250000" };
    const first = store.createRecord(input);
    const second = store.createRecord(input);
    expect(second.id).toBe(first.id);
  });

  it("is idempotent on resubmission — recipient is derived from the tx itself, so there's no conflicting-secret case", async () => {
    const store = await import("../src/btc-deposit/store");
    const txid = "bb".repeat(32);
    const first = store.createRecord({ txid, checkpointHeight: 100, recipient: RECIPIENT, amountSats: "250000" });
    const second = store.createRecord({ txid, checkpointHeight: 100, recipient: RECIPIENT, amountSats: "250000" });

    expect(second.id).toBe(first.id);
    expect(store.getRecord(first.id)?.recipient).toBe(RECIPIENT);
  });

  it("refreshes checkpointHeight on resubmission while still awaiting_proof", async () => {
    const store = await import("../src/btc-deposit/store");
    const txid = "cc".repeat(32);
    const first = store.createRecord({ txid, checkpointHeight: 100, recipient: RECIPIENT, amountSats: "250000" });
    expect(first.checkpointHeight).toBe(100);

    const refreshed = store.createRecord({ txid, checkpointHeight: 200, recipient: RECIPIENT, amountSats: "250000" });
    expect(refreshed.id).toBe(first.id);
    expect(refreshed.checkpointHeight).toBe(200);
    expect(store.getRecord(first.id)?.checkpointHeight).toBe(200);
  });

  it("does NOT refresh checkpointHeight once a record is proven (terminal, not a bookkeeping field)", async () => {
    const store = await import("../src/btc-deposit/store");
    const txid = "dd".repeat(32);
    const record = store.createRecord({ txid, checkpointHeight: 100, recipient: RECIPIENT, amountSats: "250000" });
    store.markProven(record.id, "0xproof", ["0x1", "0x2", "0x3", "0x4"]);

    const resubmitted = store.createRecord({ txid, checkpointHeight: 200, recipient: RECIPIENT, amountSats: "250000" });
    expect(resubmitted.status).toBe("proven");
    expect(resubmitted.checkpointHeight).toBe(100);
  });

  it("listProven only returns proven, not-yet-minted records", async () => {
    const store = await import("../src/btc-deposit/store");
    const txid = "ee".repeat(32);
    const record = store.createRecord({ txid, checkpointHeight: 100, recipient: RECIPIENT, amountSats: "250000" });
    expect(store.listProven()).toHaveLength(0);

    store.markProven(record.id, "0xproof", ["0x1", "0x2", "0x3", "0x4"]);
    expect(store.listProven().map((r) => r.id)).toEqual([record.id]);

    store.markMinted(record.id, "0xtxhash");
    expect(store.listProven()).toHaveLength(0);
    expect(store.getRecord(record.id)?.status).toBe("minted");
    expect(store.getRecord(record.id)?.mintTxHash).toBe("0xtxhash");
  });

  it("hasRecord reflects whether a txid has ever been submitted", async () => {
    const store = await import("../src/btc-deposit/store");
    const txid = "ff".repeat(32);
    expect(store.hasRecord(txid)).toBe(false);
    store.createRecord({ txid, checkpointHeight: 100, recipient: RECIPIENT, amountSats: "250000" });
    expect(store.hasRecord(txid)).toBe(true);
  });

  it("refreshCheckpointHeight updates an awaiting_proof record without re-fetching the tx, and no-ops for an unknown txid or an unchanged height", async () => {
    const store = await import("../src/btc-deposit/store");
    const txid = "10".repeat(32);
    const record = store.createRecord({ txid, checkpointHeight: 100, recipient: RECIPIENT, amountSats: "250000" });

    store.refreshCheckpointHeight("unknown-txid", 999);
    expect(store.getRecord(record.id)?.checkpointHeight).toBe(100);

    store.refreshCheckpointHeight(txid, 100); // unchanged — still a no-op, just via the equality branch instead of the missing-record one
    expect(store.getRecord(record.id)?.checkpointHeight).toBe(100);

    store.refreshCheckpointHeight(txid, 150);
    expect(store.getRecord(record.id)?.checkpointHeight).toBe(150);
  });

  it("refreshCheckpointHeight is a no-op once a record is proven (terminal)", async () => {
    const store = await import("../src/btc-deposit/store");
    const txid = "11".repeat(32);
    const record = store.createRecord({ txid, checkpointHeight: 100, recipient: RECIPIENT, amountSats: "250000" });
    store.markProven(record.id, "0xproof", ["0x1", "0x2", "0x3", "0x4"]);
    store.refreshCheckpointHeight(txid, 200);
    expect(store.getRecord(record.id)?.checkpointHeight).toBe(100);
  });

  it("markFailed sets status and failureReason", async () => {
    const store = await import("../src/btc-deposit/store");
    const txid = "12".repeat(32);
    const record = store.createRecord({ txid, checkpointHeight: 100, recipient: RECIPIENT, amountSats: "250000" });
    const failed = store.markFailed(record.id, "checkpoint never caught up");
    expect(failed?.status).toBe("failed");
    expect(failed?.failureReason).toBe("checkpoint never caught up");
    expect(store.markFailed("no-such-id", "x")).toBeUndefined();
  });

  it("listAwaitingProof only returns records still awaiting proof", async () => {
    const store = await import("../src/btc-deposit/store");
    const a = store.createRecord({ txid: "13".repeat(32), checkpointHeight: 100, recipient: RECIPIENT, amountSats: "1" });
    const b = store.createRecord({ txid: "14".repeat(32), checkpointHeight: 100, recipient: RECIPIENT, amountSats: "2" });
    store.markProven(b.id, "0xproof", ["0x1", "0x2", "0x3", "0x4"]);
    expect(store.listAwaitingProof().map((r) => r.id)).toEqual([a.id]);
  });

  it("markProven/markMinted/markFailed return undefined for an unknown id", async () => {
    const store = await import("../src/btc-deposit/store");
    expect(store.markProven("no-such-id", "0xproof", ["0x1", "0x2", "0x3", "0x4"])).toBeUndefined();
    expect(store.markMinted("no-such-id", "0xtx")).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("btc-deposit / store", () => {
  // store.ts's records/txidToId maps are module-level — vi.resetModules()
  // plus a fresh dynamic import gives each test a clean instance, same
  // isolation approach btc-withdrawal.test.ts already uses.
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns the same record on an identical resubmission (same txid, same blinding)", async () => {
    const store = await import("../src/btc-deposit/store");
    const input = { txid: "aa".repeat(32), checkpointHeight: 100, ownerKey: "7", amountSats: "250000", blinding: "42" };
    const first = store.createRecord(input);
    const second = store.createRecord(input);
    expect(second.id).toBe(first.id);
  });

  it("throws BlindingMismatchError on resubmission with a different blinding, without overwriting the original record", async () => {
    const store = await import("../src/btc-deposit/store");
    const txid = "bb".repeat(32);
    const first = store.createRecord({ txid, checkpointHeight: 100, ownerKey: "7", amountSats: "250000", blinding: "42" });

    expect(() =>
      store.createRecord({ txid, checkpointHeight: 100, ownerKey: "7", amountSats: "250000", blinding: "999999" })
    ).toThrow(store.BlindingMismatchError);

    // The original depositor's record must be untouched — not silently
    // overwritten by the attacker's resubmission attempt.
    const stillOriginal = store.getRecord(first.id);
    expect(stillOriginal?.blinding).toBe("42");
  });
});

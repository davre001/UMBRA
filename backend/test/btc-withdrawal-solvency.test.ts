import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";
import type { BtcWithdrawalRequest } from "../src/btc-withdrawal/types";

const ECPair = ECPairFactory(ecc);
const custodianWif = ECPair.makeRandom({ network: bitcoin.networks.testnet }).toWIF();
const reserveKeys = [1, 2, 3].map(() => ECPair.makeRandom({ network: bitcoin.networks.testnet }));

function makeRequest(nullifierHash: string, amountSats: string, status: BtcWithdrawalRequest["status"]): BtcWithdrawalRequest {
  return {
    nullifierHash,
    assetId: "999",
    destinationHash160: "aa".repeat(20),
    amountSats,
    status,
    requestedAtBlock: "100",
    observedAt: Date.now(),
  };
}

function mockBalances(custodianSats: number, reserveSats: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      // Every /address/:addr/utxo call in this test hits the same mock —
      // solvency.ts calls it twice (custodian, then reserve) via
      // Promise.all, so alternate response shape isn't distinguishable by
      // URL alone here; a single UTXO per address covering the intended
      // balance is enough since fetchConfirmedBalanceSats just sums them.
      json: async () => [{ txid: "11".repeat(32), vout: 0, value: custodianSats, status: { confirmed: true } }],
    }))
  );
  // Override per-address via call-order isn't reliable with a shared mock,
  // so this helper is only used where custodian == reserve balance doesn't
  // matter — the dedicated per-address test below stubs precisely instead.
  void reserveSats;
}

describe("btc-withdrawal / solvency", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.BTC_CUSTODIAN_WIF = custodianWif;
    reserveKeys.forEach((k, i) => (process.env[`BTC_RESERVE_PUBKEY_${i + 1}`] = Buffer.from(k.publicKey).toString("hex")));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BTC_CUSTODIAN_WIF;
    for (let i = 1; i <= 3; i++) delete process.env[`BTC_RESERVE_PUBKEY_${i}`];
  });

  it("sums the custodian and reserve balances into totalBalanceSats", async () => {
    const { getCustodianAddress } = await import("../src/btc-withdrawal/wallet");
    const { getReserveInfo } = await import("../src/btc-withdrawal/reserve");
    const custodianAddress = getCustodianAddress();
    const reserveAddress = getReserveInfo().address;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const value = url.includes(custodianAddress) ? 40_000 : url.includes(reserveAddress) ? 60_000 : 0;
        return { ok: true, status: 200, json: async () => [{ txid: "22".repeat(32), vout: 0, value, status: { confirmed: true } }] };
      })
    );

    const { computeSolvency } = await import("../src/btc-withdrawal/solvency");
    const report = await computeSolvency();
    expect(report.custodianBalanceSats).toBe("40000");
    expect(report.reserveBalanceSats).toBe("60000");
    expect(report.totalBalanceSats).toBe("100000");
  });

  it("counts pending, awaiting_signatures, AND failed records as outstanding obligations", async () => {
    const store = await import("../src/btc-withdrawal/store");
    await store.upsertPending(makeRequest("solv-1", "10000", "pending"));
    await store.upsertPending(makeRequest("solv-2", "20000", "awaiting_signatures"));
    await store.upsertPending(makeRequest("solv-3", "30000", "failed"));
    await store.upsertPending(makeRequest("solv-4", "999999", "broadcast")); // already paid — must NOT count

    mockBalances(1_000_000, 1_000_000);
    const { computeSolvency } = await import("../src/btc-withdrawal/solvency");
    const report = await computeSolvency();
    expect(report.outstandingObligationSats).toBe("60000"); // 10000 + 20000 + 30000, not the broadcast one
    expect(report.pendingCount).toBe(1);
    expect(report.awaitingSignaturesCount).toBe(1);
    expect(report.failedCount).toBe(1);
  });

  it("solvent is false when total balance is under outstanding obligations", async () => {
    const store = await import("../src/btc-withdrawal/store");
    await store.upsertPending(makeRequest("solv-insolvent", "5000000", "pending"));
    mockBalances(1_000, 1_000);
    const { computeSolvency } = await import("../src/btc-withdrawal/solvency");
    const report = await computeSolvency();
    expect(report.solvent).toBe(false);
  });
});

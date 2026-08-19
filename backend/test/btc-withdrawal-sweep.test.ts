import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";

const ECPair = ECPairFactory(ecc);
const custodianKeyPair = ECPair.makeRandom({ network: bitcoin.networks.testnet });
const custodianWif = custodianKeyPair.toWIF();
const reserveKeys = [1, 2, 3].map(() => ECPair.makeRandom({ network: bitcoin.networks.testnet }));

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

describe("btc-withdrawal / sweep", () => {
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

  it("sweeps every confirmed hot-wallet UTXO into the reserve address, leaving no deliberate balance behind", async () => {
    const { getReserveInfo } = await import("../src/btc-withdrawal/reserve");
    const reserve = getReserveInfo();

    mockFetchSequence([
      {
        url: /\/address\/.+\/utxo/,
        body: [
          { txid: "11".repeat(32), vout: 0, value: 100_000, status: { confirmed: true } },
          { txid: "22".repeat(32), vout: 1, value: 50_000, status: { confirmed: true } },
          { txid: "33".repeat(32), vout: 0, value: 999_999, status: { confirmed: false } }, // unconfirmed — must be ignored
        ],
      },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 3 } },
      { url: /\/tx$/, body: "cafebabe".repeat(8), text: true },
    ]);

    const { sweepOnce } = await import("../src/btc-withdrawal/sweep");
    const { txid, sweptSats, feeSats } = await sweepOnce();
    expect(txid).toBe("cafebabe".repeat(8));
    expect(feeSats).toBeGreaterThan(BigInt(0));
    expect(sweptSats).toBe(BigInt(150_000) - feeSats);
  });

  it("produces a single-output transaction to the reserve address with no change back to the hot wallet, real-signature-verified", async () => {
    mockFetchSequence([
      { url: /\/address\/.+\/utxo/, body: [{ txid: "44".repeat(32), vout: 0, value: 200_000, status: { confirmed: true } }] },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } },
    ]);

    // Capture the raw hex actually broadcast rather than trusting sweepOnce's
    // own return value alone.
    let broadcastHex = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (/\/address\/.+\/utxo/.test(url)) {
          return { ok: true, status: 200, json: async () => [{ txid: "44".repeat(32), vout: 0, value: 200_000, status: { confirmed: true } }] };
        }
        if (/\/v1\/fees\/recommended/.test(url)) {
          return { ok: true, status: 200, json: async () => ({ halfHourFee: 2 }) };
        }
        if (/\/tx$/.test(url)) {
          broadcastHex = init!.body as string;
          const tx = bitcoin.Transaction.fromHex(broadcastHex);
          return { ok: true, status: 200, text: async () => tx.getId() };
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      })
    );

    const { getReserveInfo } = await import("../src/btc-withdrawal/reserve");
    const reserve = getReserveInfo();
    const { sweepOnce } = await import("../src/btc-withdrawal/sweep");
    await sweepOnce();

    const tx = bitcoin.Transaction.fromHex(broadcastHex);
    expect(tx.outs.length).toBe(1);
    expect(Buffer.from(tx.outs[0].script).equals(reserve.output)).toBe(true);

    // Real, independent signature verification against the custodian's own
    // real public key — same discipline as the other btc-withdrawal tests.
    expect(tx.ins.length).toBe(1);
    const [derSigWithHashType, witnessPubkey] = tx.ins[0].witness;
    const { signature: compactSig, hashType } = bitcoin.script.signature.decode(Buffer.from(derSigWithHashType));
    const scriptCode = bitcoin.payments.p2pkh({ hash: bitcoin.crypto.hash160(Buffer.from(witnessPubkey)) }).output!;
    const sighash = tx.hashForWitnessV0(0, scriptCode, BigInt(200_000), hashType);
    expect(custodianKeyPair.verify(sighash, compactSig)).toBe(true);
    expect(Buffer.from(witnessPubkey).equals(custodianKeyPair.publicKey)).toBe(true);
  });

  it("NothingToSweepError when there are no confirmed UTXOs at all", async () => {
    mockFetchSequence([{ url: /\/address\/.+\/utxo/, body: [] }]);
    const { sweepOnce, NothingToSweepError } = await import("../src/btc-withdrawal/sweep");
    await expect(sweepOnce()).rejects.toThrow(NothingToSweepError);
  });

  it("NothingToSweepError when the confirmed balance doesn't clear fee + dust", async () => {
    mockFetchSequence([
      { url: /\/address\/.+\/utxo/, body: [{ txid: "55".repeat(32), vout: 0, value: 500, status: { confirmed: true } }] },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 5 } },
    ]);
    const { sweepOnce, NothingToSweepError } = await import("../src/btc-withdrawal/sweep");
    await expect(sweepOnce()).rejects.toThrow(NothingToSweepError);
  });

  it("pollOnce is a clean no-op (not a thrown error) when there's nothing to sweep", async () => {
    mockFetchSequence([{ url: /\/address\/.+\/utxo/, body: [] }]);
    const { pollOnce } = await import("../src/btc-withdrawal/sweep");
    const result = await pollOnce();
    expect(result).toEqual({ swept: false });
  });

  it("pollOnce reports the swept amount and txid on success", async () => {
    mockFetchSequence([
      { url: /\/address\/.+\/utxo/, body: [{ txid: "66".repeat(32), vout: 0, value: 100_000, status: { confirmed: true } }] },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } },
      { url: /\/tx$/, body: "abcdef01".repeat(8), text: true },
    ]);
    const { pollOnce } = await import("../src/btc-withdrawal/sweep");
    const result = await pollOnce();
    expect(result.swept).toBe(true);
    expect(result.txid).toBe("abcdef01".repeat(8));
    expect(BigInt(result.sweptSats!)).toBeGreaterThan(BigInt(0));
  });
});

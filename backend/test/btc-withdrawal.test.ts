import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";

const ECPair = ECPairFactory(ecc);

// A fresh, throwaway keypair generated for this test run only — never a
// real/funded key, never committed anywhere reused. Real custodian keys
// come from BTC_CUSTODIAN_WIF (see wallet.ts), never hardcoded.
const testKeyPair = ECPair.makeRandom({ network: bitcoin.networks.testnet });
const testWif = testKeyPair.toWIF();
const testAddress = bitcoin.payments.p2wpkh({ pubkey: testKeyPair.publicKey, network: bitcoin.networks.testnet }).address!;
const testScript = bitcoin.payments.p2wpkh({ pubkey: testKeyPair.publicKey, network: bitcoin.networks.testnet }).output!;

const DESTINATION_HASH160 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

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

describe("btc-withdrawal / bitcoin-tx", () => {
  beforeEach(() => {
    process.env.BTC_CUSTODIAN_WIF = testWif;
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BTC_CUSTODIAN_WIF;
  });

  it("builds a validly-signed transaction paying the requested amount, with change back to the custodian", async () => {
    mockFetchSequence([
      {
        url: /\/address\/.+\/utxo/,
        body: [
          { txid: "11".repeat(32), vout: 0, value: 100_000, status: { confirmed: true } },
          { txid: "22".repeat(32), vout: 1, value: 50_000, status: { confirmed: true } },
        ],
      },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 5 } },
    ]);

    const { buildAndSignWithdrawal } = await import("../src/btc-withdrawal/bitcoin-tx");
    const { rawHex, txid, feeSats } = await buildAndSignWithdrawal(DESTINATION_HASH160, BigInt(80_000));

    expect(txid).toMatch(/^[0-9a-f]{64}$/);
    expect(feeSats).toBeGreaterThan(BigInt(0));

    // Independently decode and verify — not just "it didn't throw".
    const tx = bitcoin.Transaction.fromHex(rawHex);
    expect(tx.outs.length).toBe(2); // payment + change (100_000 sat input alone covers amount+fee, second UTXO unused)
    expect(tx.outs[0].value).toBe(80_000n);

    const destinationScript = bitcoin.payments.p2wpkh({
      hash: Buffer.from(DESTINATION_HASH160, "hex"),
      network: bitcoin.networks.testnet,
    }).output!;
    expect(Buffer.from(tx.outs[0].script).equals(destinationScript)).toBe(true);
    expect(Buffer.from(tx.outs[1].script).equals(testScript)).toBe(true);

    // Real, independent signature verification — not just "a witness is
    // present". Recomputes the P2WPKH sighash directly and checks it
    // against the witness's own signature + pubkey with the test keypair's
    // own verify(), the same way a real Bitcoin node would.
    expect(tx.ins.length).toBe(1);
    const [derSigWithHashType, witnessPubkey] = tx.ins[0].witness;
    const { signature: compactSig, hashType } = bitcoin.script.signature.decode(Buffer.from(derSigWithHashType));
    const scriptCode = bitcoin.payments.p2pkh({ hash: bitcoin.crypto.hash160(Buffer.from(witnessPubkey)) }).output!;
    const sighash = tx.hashForWitnessV0(0, scriptCode, BigInt(100_000), hashType);
    expect(ECPair.fromPublicKey(Buffer.from(witnessPubkey)).verify(sighash, compactSig)).toBe(true);
    expect(Buffer.from(witnessPubkey).equals(testKeyPair.publicKey)).toBe(true);
  });

  it("drops the change output when it would be dust", async () => {
    mockFetchSequence([
      {
        url: /\/address\/.+\/utxo/,
        body: [{ txid: "33".repeat(32), vout: 0, value: 80_300, status: { confirmed: true } }],
      },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } },
    ]);

    const { buildAndSignWithdrawal } = await import("../src/btc-withdrawal/bitcoin-tx");
    // 80,300 in, 80,000 out, ~200ish fee -> change is under the 546 sat dust threshold.
    const { rawHex } = await buildAndSignWithdrawal(DESTINATION_HASH160, BigInt(80_000));
    const tx = bitcoin.Transaction.fromHex(rawHex);
    expect(tx.outs.length).toBe(1);
  });

  it("throws InsufficientFundsError when the custodian can't cover amount + fee", async () => {
    mockFetchSequence([
      { url: /\/address\/.+\/utxo/, body: [{ txid: "44".repeat(32), vout: 0, value: 1_000, status: { confirmed: true } }] },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } },
    ]);

    const { buildAndSignWithdrawal, InsufficientFundsError } = await import("../src/btc-withdrawal/bitcoin-tx");
    await expect(buildAndSignWithdrawal(DESTINATION_HASH160, BigInt(80_000))).rejects.toThrow(InsufficientFundsError);
  });

  it("ignores unconfirmed UTXOs when selecting inputs", async () => {
    mockFetchSequence([
      {
        url: /\/address\/.+\/utxo/,
        body: [
          { txid: "55".repeat(32), vout: 0, value: 1_000_000, status: { confirmed: false } },
          { txid: "66".repeat(32), vout: 0, value: 90_000, status: { confirmed: true } },
        ],
      },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } },
    ]);

    const { buildAndSignWithdrawal } = await import("../src/btc-withdrawal/bitcoin-tx");
    const { rawHex } = await buildAndSignWithdrawal(DESTINATION_HASH160, BigInt(80_000));
    const tx = bitcoin.Transaction.fromHex(rawHex);
    // Only the confirmed UTXO's txid should appear as an input.
    expect(tx.ins.length).toBe(1);
    expect(Buffer.from(tx.ins[0].hash).reverse().toString("hex")).toBe("66".repeat(32));
  });
});

describe("btc-withdrawal / wallet", () => {
  beforeEach(() => {
    process.env.BTC_CUSTODIAN_WIF = testWif;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.BTC_CUSTODIAN_WIF;
  });

  it("derives the same P2WPKH address bitcoinjs-lib itself derives for this key", async () => {
    const { getCustodianAddress } = await import("../src/btc-withdrawal/wallet");
    expect(getCustodianAddress()).toBe(testAddress);
  });

  it("derives a pubkey hash matching the address's own hash160", async () => {
    const { getCustodianAddress, getCustodianPubkeyHash } = await import("../src/btc-withdrawal/wallet");
    const address = getCustodianAddress();
    const decoded = bitcoin.address.fromBech32(address);
    expect(getCustodianPubkeyHash()).toBe(Buffer.from(decoded.data).toString("hex"));
  });

  it("throws a clear error when BTC_CUSTODIAN_WIF is unset", async () => {
    delete process.env.BTC_CUSTODIAN_WIF;
    const { getCustodianAddress } = await import("../src/btc-withdrawal/wallet");
    expect(() => getCustodianAddress()).toThrow(/BTC_CUSTODIAN_WIF/);
  });
});

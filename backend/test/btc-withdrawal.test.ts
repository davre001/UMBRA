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

// Three fresh, throwaway reserve signer keypairs — same disclosure as
// above, never real keys. Real ones come from the BTC_RESERVE_SIGNER_*_WIF
// values distributed to each signer individually (see reserve.ts's own
// doc — this backend never holds any of them).
const reserveKeyPairs = [1, 2, 3].map(() => ECPair.makeRandom({ network: bitcoin.networks.testnet }));

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

describe("btc-withdrawal / bitcoin-tx (2-of-3 reserve PSBT)", () => {
  beforeEach(() => {
    process.env.BTC_CUSTODIAN_WIF = testWif;
    reserveKeyPairs.forEach((k, i) => {
      process.env[`BTC_RESERVE_PUBKEY_${i + 1}`] = Buffer.from(k.publicKey).toString("hex");
    });
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BTC_CUSTODIAN_WIF;
    for (let i = 1; i <= 3; i++) delete process.env[`BTC_RESERVE_PUBKEY_${i}`];
  });

  /** Signs `psbtBase64` with exactly 2 of the 3 reserve keypairs — real signInput calls, same as scripts/sign-btc-withdrawal.ts's own signers would each do independently, then combined here to mirror the backend's own Psbt.combine step. */
  function signWithTwoReserveKeys(psbtBase64: string): string {
    const [a, b] = reserveKeyPairs;
    const psbtA = bitcoin.Psbt.fromBase64(psbtBase64, { network: bitcoin.networks.testnet });
    psbtA.signAllInputs(a);
    const psbtB = bitcoin.Psbt.fromBase64(psbtBase64, { network: bitcoin.networks.testnet });
    psbtB.signAllInputs(b);
    psbtA.combine(psbtB);
    return psbtA.toBase64();
  }

  it("builds an unsigned PSBT paying the requested amount from the reserve, with change back to the reserve", async () => {
    const { getReserveInfo } = await import("../src/btc-withdrawal/reserve");
    const reserve = getReserveInfo();

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

    const { buildWithdrawalPsbt } = await import("../src/btc-withdrawal/bitcoin-tx");
    const { psbt: psbtBase64, feeSats } = await buildWithdrawalPsbt(DESTINATION_HASH160, BigInt(80_000));
    expect(feeSats).toBeGreaterThan(BigInt(0));

    const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: bitcoin.networks.testnet });
    expect(psbt.txOutputs.length).toBe(2); // payment + change (100_000 sat input alone covers amount+fee, second UTXO unused)
    expect(psbt.txOutputs[0].value).toBe(80_000n);

    const destinationScript = bitcoin.payments.p2wpkh({
      hash: Buffer.from(DESTINATION_HASH160, "hex"),
      network: bitcoin.networks.testnet,
    }).output!;
    expect(Buffer.from(psbt.txOutputs[0].script).equals(destinationScript)).toBe(true);
    expect(Buffer.from(psbt.txOutputs[1].script).equals(reserve.output)).toBe(true);
    expect(psbt.data.inputs.length).toBe(1);
    // Not yet spendable — no signatures collected at build time.
    expect(psbt.data.inputs[0].partialSig ?? []).toHaveLength(0);
  });

  it("is not spendable with only 1 of 3 reserve signatures, and hasEnoughSignatures reflects that", async () => {
    mockFetchSequence([
      { url: /\/address\/.+\/utxo/, body: [{ txid: "33".repeat(32), vout: 0, value: 200_000, status: { confirmed: true } }] },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } },
    ]);
    const { buildWithdrawalPsbt, hasEnoughSignatures, finalizeWithdrawalPsbt } = await import("../src/btc-withdrawal/bitcoin-tx");
    const { psbt: psbtBase64 } = await buildWithdrawalPsbt(DESTINATION_HASH160, BigInt(80_000));

    const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: bitcoin.networks.testnet });
    psbt.signAllInputs(reserveKeyPairs[0]);
    expect(hasEnoughSignatures(psbt)).toBe(false);
    expect(() => finalizeWithdrawalPsbt(psbt.toBase64())).toThrow(/>= 2 signatures/);
  });

  it("finalizes into a real, independently-verifiable 2-of-3 multisig transaction once 2 of 3 reserve signers sign", async () => {
    const { getReserveInfo } = await import("../src/btc-withdrawal/reserve");
    const reserve = getReserveInfo();

    mockFetchSequence([
      { url: /\/address\/.+\/utxo/, body: [{ txid: "44".repeat(32), vout: 0, value: 200_000, status: { confirmed: true } }] },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } },
    ]);
    const { buildWithdrawalPsbt, hasEnoughSignatures, finalizeWithdrawalPsbt } = await import("../src/btc-withdrawal/bitcoin-tx");
    const { psbt: unsigned } = await buildWithdrawalPsbt(DESTINATION_HASH160, BigInt(80_000));

    const combined = signWithTwoReserveKeys(unsigned);
    const combinedPsbt = bitcoin.Psbt.fromBase64(combined, { network: bitcoin.networks.testnet });
    expect(hasEnoughSignatures(combinedPsbt)).toBe(true);

    const { rawHex, txid } = finalizeWithdrawalPsbt(combined);
    expect(txid).toMatch(/^[0-9a-f]{64}$/);

    // Independently decode and verify the finalized transaction — not just
    // "it didn't throw". Real multisig witness stack verification: decode
    // each signature out of the witness, recompute the real P2WSH sighash,
    // and check both against the two signers' own real public keys, the
    // same way a real Bitcoin node's script interpreter would.
    const tx = bitcoin.Transaction.fromHex(rawHex);
    expect(tx.ins.length).toBe(1);
    // witness: [dummy OP_0, sig1, sig2, witnessScript] — 4 items for 2-of-3.
    const witness = tx.ins[0].witness.map((w) => Buffer.from(w));
    expect(witness).toHaveLength(4);
    expect(witness[0].length).toBe(0); // the OP_CHECKMULTISIG off-by-one dummy element
    const witnessScriptFromTx = witness[3];
    expect(witnessScriptFromTx.equals(reserve.redeemOutput)).toBe(true);

    const sighash = tx.hashForWitnessV0(0, reserve.redeemOutput, BigInt(200_000), bitcoin.Transaction.SIGHASH_ALL);
    for (const sigBytes of [witness[1], witness[2]]) {
      const { signature: compactSig } = bitcoin.script.signature.decode(sigBytes);
      const matchesSomeSigner = reserveKeyPairs.some((kp) => kp.verify(sighash, compactSig));
      expect(matchesSomeSigner).toBe(true);
    }
  });

  it("drops the change output when it would be dust", async () => {
    mockFetchSequence([
      {
        url: /\/address\/.+\/utxo/,
        body: [{ txid: "55".repeat(32), vout: 0, value: 80_600, status: { confirmed: true } }],
      },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } },
    ]);

    const { buildWithdrawalPsbt } = await import("../src/btc-withdrawal/bitcoin-tx");
    // 80,600 in, 80,000 out, a 2-of-3 P2WSH input's larger fee eats most of
    // the rest -> change lands under the 546 sat dust threshold.
    const { psbt: psbtBase64 } = await buildWithdrawalPsbt(DESTINATION_HASH160, BigInt(80_000));
    const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: bitcoin.networks.testnet });
    expect(psbt.txOutputs.length).toBe(1);
  });

  it("throws InsufficientFundsError when the reserve can't cover amount + fee", async () => {
    mockFetchSequence([
      { url: /\/address\/.+\/utxo/, body: [{ txid: "66".repeat(32), vout: 0, value: 1_000, status: { confirmed: true } }] },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } },
    ]);

    const { buildWithdrawalPsbt, InsufficientFundsError } = await import("../src/btc-withdrawal/bitcoin-tx");
    await expect(buildWithdrawalPsbt(DESTINATION_HASH160, BigInt(80_000))).rejects.toThrow(InsufficientFundsError);
  });

  it("ignores unconfirmed UTXOs when selecting inputs", async () => {
    mockFetchSequence([
      {
        url: /\/address\/.+\/utxo/,
        body: [
          { txid: "77".repeat(32), vout: 0, value: 1_000_000, status: { confirmed: false } },
          { txid: "88".repeat(32), vout: 0, value: 200_000, status: { confirmed: true } },
        ],
      },
      { url: /\/v1\/fees\/recommended/, body: { halfHourFee: 2 } },
    ]);

    const { buildWithdrawalPsbt } = await import("../src/btc-withdrawal/bitcoin-tx");
    const { psbt: psbtBase64 } = await buildWithdrawalPsbt(DESTINATION_HASH160, BigInt(80_000));
    const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: bitcoin.networks.testnet });
    // Only the confirmed UTXO's txid should appear as an input.
    expect(psbt.txInputs).toHaveLength(1);
    expect(Buffer.from(psbt.txInputs[0].hash).reverse().toString("hex")).toBe("88".repeat(32));
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

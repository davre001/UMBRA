import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";

const ECPair = ECPairFactory(ecc);
const keys = [1, 2, 3].map(() => ECPair.makeRandom({ network: bitcoin.networks.testnet }));

describe("btc-withdrawal / reserve", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    for (let i = 1; i <= 3; i++) delete process.env[`BTC_RESERVE_PUBKEY_${i}`];
  });

  it("derives a real, valid signet P2WSH address deterministically from the 3 configured pubkeys", async () => {
    keys.forEach((k, i) => (process.env[`BTC_RESERVE_PUBKEY_${i + 1}`] = Buffer.from(k.publicKey).toString("hex")));
    const { getReserveInfo } = await import("../src/btc-withdrawal/reserve");
    const a = getReserveInfo();
    const b = getReserveInfo(); // cached — must be the identical object/address, not recomputed
    expect(a.address).toBe(b.address);
    expect(a.address.startsWith("tb1q")).toBe(true); // signet/testnet bech32 native segwit prefix
    expect(a.address.length).toBeGreaterThan(60); // P2WSH addresses are longer than P2WPKH's

    // Independently re-derive with bitcoinjs-lib directly, not just trust
    // reserve.ts's own arithmetic — same discipline the wallet.ts tests use.
    const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys: keys.map((k) => Buffer.from(k.publicKey)), network: bitcoin.networks.testnet });
    const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network: bitcoin.networks.testnet });
    expect(a.address).toBe(p2wsh.address);
  });

  it("produces a real 2-of-3 witnessScript (OP_2 ... OP_3 OP_CHECKMULTISIG) containing all 3 pubkeys", async () => {
    keys.forEach((k, i) => (process.env[`BTC_RESERVE_PUBKEY_${i + 1}`] = Buffer.from(k.publicKey).toString("hex")));
    const { getReserveInfo } = await import("../src/btc-withdrawal/reserve");
    const { redeemOutput } = getReserveInfo();

    const decoded = bitcoin.script.decompile(redeemOutput)!;
    expect(decoded[0]).toBe(bitcoin.opcodes.OP_2);
    expect(decoded[decoded.length - 2]).toBe(bitcoin.opcodes.OP_3);
    expect(decoded[decoded.length - 1]).toBe(bitcoin.opcodes.OP_CHECKMULTISIG);
    const embeddedPubkeys = decoded.slice(1, 4) as Buffer[];
    for (const k of keys) {
      expect(embeddedPubkeys.some((p) => Buffer.from(p).equals(Buffer.from(k.publicKey)))).toBe(true);
    }
  });

  it("throws a clear error when a reserve pubkey is missing", async () => {
    process.env.BTC_RESERVE_PUBKEY_1 = Buffer.from(keys[0].publicKey).toString("hex");
    process.env.BTC_RESERVE_PUBKEY_2 = Buffer.from(keys[1].publicKey).toString("hex");
    // BTC_RESERVE_PUBKEY_3 deliberately left unset.
    const { getReserveInfo } = await import("../src/btc-withdrawal/reserve");
    expect(() => getReserveInfo()).toThrow(/BTC_RESERVE_PUBKEY_3/);
  });

  it("throws a clear error when a reserve pubkey is the wrong length", async () => {
    process.env.BTC_RESERVE_PUBKEY_1 = "aabbcc"; // 3 bytes, not a real 33-byte compressed pubkey
    process.env.BTC_RESERVE_PUBKEY_2 = Buffer.from(keys[1].publicKey).toString("hex");
    process.env.BTC_RESERVE_PUBKEY_3 = Buffer.from(keys[2].publicKey).toString("hex");
    const { getReserveInfo } = await import("../src/btc-withdrawal/reserve");
    expect(() => getReserveInfo()).toThrow(/33-byte compressed pubkey/);
  });
});

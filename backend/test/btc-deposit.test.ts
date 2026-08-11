import { describe, it, expect } from "vitest";
import { stripWitness, parseDepositTx, TX_SIZE } from "../src/btc-deposit/mempool";

describe("btc-deposit / stripWitness", () => {
  // Real signet transaction 913c43415145e84d11b73d292eff432b4ba832913f31096f30f0a6de4721f82b
  // (height 317028), fetched live from mempool.space on 2026-08-10 — same
  // real tx contract/circuits/BTC_DEPOSIT_DESIGN.md's Phase 4 fixture uses.
  // Its raw hex was independently reconstructed by hand there (Taproot
  // input, empty scriptSig) and cross-checked byte-for-byte before being
  // trusted; this test confirms this module's general-purpose parser
  // reproduces the exact same non-witness bytes.
  it("reproduces the real, manually-derived non-witness serialization for a real SegWit tx", async () => {
    const res = await fetch(
      "https://mempool.space/signet/api/tx/913c43415145e84d11b73d292eff432b4ba832913f31096f30f0a6de4721f82b/hex"
    );
    expect(res.ok, "mempool.space signet API must be reachable for this test").toBe(true);
    const rawHex = (await res.text()).trim();

    const nonWitness = stripWitness(rawHex);
    expect(nonWitness.length).toBe(82);
    expect(nonWitness.toString("hex")).toBe(
      "0200000001dc2ec6282f4d0bc795f6e2a3c856ca8052232b160b2812b2b04e78ca9a23f6f0060000000022010000016ceca90c00000000160014360a3ba02d9603554f7746bf90e7c10d107d2cca00000000"
    );
  });

  it("passes a legacy (non-SegWit) transaction through unchanged", () => {
    // version(4) + inputCount(1)=0 + outputCount(1)=0 + locktime(4) — a
    // minimal, structurally valid legacy (no marker/flag) transaction with
    // no inputs/outputs, just to exercise the non-SegWit branch.
    const raw = Buffer.concat([
      Buffer.from([0x01, 0x00, 0x00, 0x00]), // version = 1
      Buffer.from([0x00]), // input count = 0
      Buffer.from([0x00]), // output count = 0
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // locktime
    ]);
    const stripped = stripWitness(raw.toString("hex"));
    expect(stripped.equals(raw)).toBe(true);
  });
});

describe("btc-deposit / parseDepositTx", () => {
  function buildSyntheticDepositTx(ownerKey: bigint, amountSats: bigint, vaultPubkeyHash: Buffer): Buffer {
    const version = Buffer.from([0x02, 0x00, 0x00, 0x00]);
    const inputCount = Buffer.from([0x01]);
    const prevTxid = Buffer.alloc(32, 0x11);
    const prevVout = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const scriptSigLen = Buffer.from([0x00]);
    const sequence = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    const outputCount = Buffer.from([0x02]);

    const ownerKeyBE = Buffer.alloc(32);
    let v = ownerKey;
    for (let i = 31; i >= 0; i--) {
      ownerKeyBE[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    const out0Value = Buffer.alloc(8, 0);
    const out0Script = Buffer.concat([Buffer.from([0x6a, 0x20]), ownerKeyBE]);
    const out0ScriptLen = Buffer.from([out0Script.length]);

    const out1Value = Buffer.alloc(8);
    out1Value.writeBigUInt64LE(amountSats);
    const out1Script = Buffer.concat([Buffer.from([0x00, 0x14]), vaultPubkeyHash]);
    const out1ScriptLen = Buffer.from([out1Script.length]);

    const locktime = Buffer.alloc(4, 0);

    return Buffer.concat([
      version,
      inputCount,
      prevTxid,
      prevVout,
      scriptSigLen,
      sequence,
      outputCount,
      out0Value,
      out0ScriptLen,
      out0Script,
      out1Value,
      out1ScriptLen,
      out1Script,
      locktime,
    ]);
  }

  // Must match the real BTC_VAULT_PUBKEY_HASH now in .env (vitest.setup.ts
  // loads it via dotenv/config) — mempool.ts's VAULT_PUBKEY_HASH constant
  // is real, not the zero placeholder, as of this deployment's real
  // custodian address (tb1qrmq4qvr3qmcn5s6yxlcr7y80cry0530n99g2mm).
  const VAULT_HASH = Buffer.from("1ec150307106f13a434437f03f10efc0c8fa45f3", "hex");

  it("extracts ownerKey and amountSats from a template-matching tx", () => {
    const tx = buildSyntheticDepositTx(7n, 250000n, VAULT_HASH);
    expect(tx.length).toBe(TX_SIZE);
    const { ownerKey, amountSats } = parseDepositTx(tx);
    expect(ownerKey).toBe(7n);
    expect(amountSats).toBe(250000n);
  });

  it("rejects a tx paying a different destination than the configured vault", () => {
    const wrongVault = Buffer.alloc(20, 0xaa);
    const tx = buildSyntheticDepositTx(7n, 250000n, wrongVault);
    expect(() => parseDepositTx(tx)).toThrow(/vault address/);
  });

  it("rejects a tx with the wrong output count", () => {
    const tx = buildSyntheticDepositTx(7n, 250000n, VAULT_HASH);
    tx[46] = 1; // claim 1 output instead of 2
    expect(() => parseDepositTx(tx)).toThrow(/2 outputs/);
  });

  it("rejects a tx with a non-empty scriptSig", () => {
    const tx = buildSyntheticDepositTx(7n, 250000n, VAULT_HASH);
    tx[41] = 1; // claim a 1-byte scriptSig
    expect(() => parseDepositTx(tx)).toThrow(/scriptSig/);
  });
});

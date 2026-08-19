import { describe, it, expect, afterEach, vi } from "vitest";
import { stripWitness, parseDepositTx, assembleDepositProofInputs, TX_SIZE, HEADER_SIZE, K } from "../src/btc-deposit/mempool";

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

function buildSyntheticDepositTx(recipient: `0x${string}`, amountSats: bigint, vaultPubkeyHash: Buffer): Buffer {
    const version = Buffer.from([0x02, 0x00, 0x00, 0x00]);
    const inputCount = Buffer.from([0x01]);
    const prevTxid = Buffer.alloc(32, 0x11);
    const prevVout = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const scriptSigLen = Buffer.from([0x00]);
    const sequence = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    const outputCount = Buffer.from([0x02]);

    const recipientBytes = Buffer.from(recipient.slice(2), "hex");
    if (recipientBytes.length !== 20) throw new Error("recipient must be a 20-byte address");
    const push32 = Buffer.concat([Buffer.alloc(12, 0), recipientBytes]);

    const out0Value = Buffer.alloc(8, 0);
    const out0Script = Buffer.concat([Buffer.from([0x6a, 0x20]), push32]);
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
const RECIPIENT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;

describe("btc-deposit / parseDepositTx", () => {
  it("extracts recipient and amountSats from a template-matching tx", () => {
    const tx = buildSyntheticDepositTx(RECIPIENT, 250000n, VAULT_HASH);
    expect(tx.length).toBe(TX_SIZE);
    const { recipient, amountSats } = parseDepositTx(tx);
    expect(recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(amountSats).toBe(250000n);
  });

  it("rejects a tx whose push32 isn't zero-padded before the recipient address", () => {
    const tx = buildSyntheticDepositTx(RECIPIENT, 250000n, VAULT_HASH);
    tx[58] = 0xff; // corrupt the first padding byte
    expect(() => parseDepositTx(tx)).toThrow(/zero-padded/);
  });

  it("rejects a tx paying a different destination than the configured vault", () => {
    const wrongVault = Buffer.alloc(20, 0xaa);
    const tx = buildSyntheticDepositTx(RECIPIENT, 250000n, wrongVault);
    expect(() => parseDepositTx(tx)).toThrow(/vault address/);
  });

  it("rejects a tx with the wrong output count", () => {
    const tx = buildSyntheticDepositTx(RECIPIENT, 250000n, VAULT_HASH);
    tx[46] = 1; // claim 1 output instead of 2
    expect(() => parseDepositTx(tx)).toThrow(/2 outputs/);
  });

  it("rejects a tx with a non-empty scriptSig", () => {
    const tx = buildSyntheticDepositTx(RECIPIENT, 250000n, VAULT_HASH);
    tx[41] = 1; // claim a 1-byte scriptSig
    expect(() => parseDepositTx(tx)).toThrow(/scriptSig/);
  });
});

function reverseHex(hex: string): string {
  return Buffer.from(hex, "hex").reverse().toString("hex");
}

describe("btc-deposit / assembleDepositProofInputs", () => {
  const CHECKPOINT_HEIGHT = 1000;
  const EXPECTED_HEIGHT = CHECKPOINT_HEIGHT + K; // K headers past the checkpoint — assembleDepositProofInputs's own fixed v1 constraint
  const TXID = "cc".repeat(32);
  const EMBEDDED_MERKLE_ROOT = Buffer.alloc(32, 0xcd);

  function buildTipHeader(): Buffer {
    const header = Buffer.alloc(HEADER_SIZE, 0);
    EMBEDDED_MERKLE_ROOT.copy(header, 36); // bytes 36-68 of a real Bitcoin header are its merkle root
    return header;
  }

  /** Routes every mempool.ts endpoint this function calls to a deterministic, self-consistent synthetic response. */
  function mockRealisticAssembly(overrides: { confirmed?: boolean; blockHeight?: number; merkleDepth?: number; corruptMerkleRoot?: boolean } = {}) {
    const { confirmed = true, blockHeight = EXPECTED_HEIGHT, merkleDepth = 1, corruptMerkleRoot = false } = overrides;
    const depositTx = buildSyntheticDepositTx(RECIPIENT, 250000n, VAULT_HASH);
    const reportedMerkleRoot = corruptMerkleRoot
      ? reverseHex(Buffer.alloc(32, 0xff).toString("hex"))
      : reverseHex(EMBEDDED_MERKLE_ROOT.toString("hex"));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const text = (body: string) => ({ ok: true, text: async () => body });
        if (url.endsWith(`/tx/${TXID}`)) return text(JSON.stringify({ status: { confirmed, block_height: blockHeight } }));
        if (url.endsWith(`/tx/${TXID}/hex`)) return text(depositTx.toString("hex"));
        if (url.endsWith(`/tx/${TXID}/merkle-proof`)) {
          return text(JSON.stringify({ block_height: blockHeight, merkle: Array(merkleDepth).fill("dd".repeat(32)), pos: 0 }));
        }
        if (url.match(/\/block-height\/(\d+)$/)) return text("aa".repeat(32)); // display-order block hash, any value — reverseHex'd but never independently checked
        // Every header request gets the same (tip) header — harmless since
        // assembleDepositProofInputs only ever inspects headers[K-1]'s
        // embedded merkle root, and every other header just needs to be a
        // real HEADER_SIZE-byte buffer (its content isn't otherwise checked
        // here — real header-chain/PoW linkage is the circuit's job, not
        // this assembly step's).
        if (url.match(/\/block\/[0-9a-f]{64}\/header$/)) return text(buildTipHeader().toString("hex"));
        if (url.match(/\/block\/[0-9a-f]{64}$/)) return text(JSON.stringify({ merkle_root: reportedMerkleRoot }));
        throw new Error(`Unexpected fetch: ${url}`);
      })
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  it("assembles real-shaped circuit inputs when the tx confirms exactly K headers past the checkpoint", async () => {
    mockRealisticAssembly();
    const result = await assembleDepositProofInputs(TXID, CHECKPOINT_HEIGHT);
    expect(result.headers).toHaveLength(K);
    expect(result.headers.every((h) => Buffer.from(h, "hex").length === HEADER_SIZE)).toBe(true);
    expect(result.recipient.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(result.amountSats).toBe("250000");
    expect(result.merklePathElements).toHaveLength(20); // MAX_MERKLE_DEPTH, zero-padded
    expect(result.merklePathIndices).toHaveLength(20);
    expect(result.merkleActualDepth).toBe(1);
  });

  it("rejects an unconfirmed tx", async () => {
    mockRealisticAssembly({ confirmed: false });
    await expect(assembleDepositProofInputs(TXID, CHECKPOINT_HEIGHT)).rejects.toThrow(/not yet confirmed/);
  });

  it("rejects a tx confirmed at the wrong height relative to the checkpoint", async () => {
    mockRealisticAssembly({ blockHeight: EXPECTED_HEIGHT + 1 });
    await expect(assembleDepositProofInputs(TXID, CHECKPOINT_HEIGHT)).rejects.toThrow(/needs it at exactly/);
  });

  it("rejects a Merkle path deeper than MAX_MERKLE_DEPTH", async () => {
    mockRealisticAssembly({ merkleDepth: 21 });
    await expect(assembleDepositProofInputs(TXID, CHECKPOINT_HEIGHT)).rejects.toThrow(/exceeds MAX_MERKLE_DEPTH/);
  });

  it("rejects when the tip header's embedded merkle root disagrees with the independently-reported one", async () => {
    mockRealisticAssembly({ corruptMerkleRoot: true });
    await expect(assembleDepositProofInputs(TXID, CHECKPOINT_HEIGHT)).rejects.toThrow(/merkle_root mismatch/);
  });
});

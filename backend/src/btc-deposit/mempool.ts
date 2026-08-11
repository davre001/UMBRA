import { logger } from "../shared/logger";
import type { BtcDepositCircuitInputs } from "./types";

/**
 * Fetches real Bitcoin signet chain data from mempool.space and assembles
 * it into exactly the shape contract/circuits/noir/btc_deposit/src/
 * main.nr's circuit expects — mirroring that circuit's own byte-offset
 * constants and template assertions (bitcoin.nr's `parse_deposit_tx`) so a
 * malformed/mismatched real transaction fails here, with a clear message,
 * rather than producing a doomed proving attempt.
 *
 * Deliberately backend-side rather than direct-from-the-browser: this
 * repo's FTSOv2 pricing/FDC compliance data both already go through this
 * backend rather than being fetched client-side (confirmed — no existing
 * direct-client-side-external-fetch precedent anywhere in this repo), and
 * this same fetched/formatted data is also what the proving worker needs
 * (see btc-deposit.routes.ts's secret-gated /proof-inputs route) — building
 * it once here, rather than duplicating this parsing in the frontend too,
 * keeps a single source of truth for "what does a valid deposit tx look
 * like."
 *
 * Unlike every other UMBRA circuit, there is nothing private here at all:
 * `recipient` (the depositor's own EVM address) and `amountSats` are both
 * read straight off the confirmed Bitcoin transaction, which is public the
 * moment it confirms — the circuit just proves that public data really
 * appears in a really-confirmed signet block, then mints real WrappedBTC
 * straight to `recipient`'s public balance. No blinding, no note, nothing
 * for this backend (or anyone else) to ever unlink.
 */

// A single explicit override (MEMPOOL_SIGNET_API_BASE) means exactly that
// source, no fallback — otherwise try three real public signet indexers in
// turn. Added after a live Coston2/Render deployment hit three DIFFERENT
// real failure modes back to back: mempool.space is unreachable from
// Render's own network entirely (confirmed, not a guess — see this repo's
// deploy history), blockstream.info rate-limited Render's IP under this
// session's own testing traffic (and that limit held for minutes, not the
// seconds a transient blip would suggest), and mempool.emzy.de (a
// community-run mirror serving the same real signet chain — cross-checked
// against a known block hash before trusting it) is what finally got
// through. A single hardcoded base made every real deposit submission
// depend on whichever one happened to be up; this export is what
// backend/src/btc-deposit/btc-deposit.routes.ts's /submit handler now also
// goes through, instead of its own separate hardcoded fetch.
export const SIGNET_API_BASES = process.env.MEMPOOL_SIGNET_API_BASE
  ? [process.env.MEMPOOL_SIGNET_API_BASE]
  : ["https://mempool.space/signet/api", "https://blockstream.info/signet/api", "https://mempool.emzy.de/signet/api"];

export const HEADER_SIZE = 80;
export const K = 6;
export const TX_SIZE = 125;
export const MAX_MERKLE_DEPTH = 20;

// Same zero placeholder contract/circuits/noir/btc_deposit/src/bitcoin.nr
// uses for VAULT_PUBKEY_HASH — override via env once a real signet vault
// address is deployed. Both sides (this file, the circuit) must agree, or
// every real deposit would fail parse_deposit_tx's destination check.
export const VAULT_PUBKEY_HASH = (process.env.BTC_VAULT_PUBKEY_HASH ?? "00".repeat(20)).toLowerCase();

class MempoolFetchError extends Error {}
class TemplateMismatchError extends Error {}

/** Tries each of SIGNET_API_BASES in turn, returning the first that responds ok — see that export's own comment for why a single hardcoded source isn't reliable enough. */
export async function mempoolGet(path: string): Promise<string> {
  let lastErr: unknown;
  for (const base of SIGNET_API_BASES) {
    try {
      const res = await fetch(`${base}${path}`);
      if (res.ok) return res.text();
      lastErr = new MempoolFetchError(`${base}${path} -> HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new MempoolFetchError(String(lastErr));
}

async function mempoolGetJson<T>(path: string): Promise<T> {
  return JSON.parse(await mempoolGet(path)) as T;
}

function reverseHex(hex: string): string {
  const bytes = Buffer.from(hex, "hex");
  return Buffer.from(bytes).reverse().toString("hex");
}

// --- SegWit witness stripping -------------------------------------------
// Validated against a real, naturally-occurring signet transaction before
// trusting it — see contract/circuits/BTC_DEPOSIT_DESIGN.md's Phase 4
// fixture note for the same real tx's manually-derived non-witness bytes,
// which this logic reproduces byte-for-byte.

function readVarInt(buf: Buffer, offset: number): { value: number; size: number } {
  const first = buf[offset];
  if (first < 0xfd) return { value: first, size: 1 };
  if (first === 0xfd) return { value: buf.readUInt16LE(offset + 1), size: 3 };
  if (first === 0xfe) return { value: buf.readUInt32LE(offset + 1), size: 5 };
  return { value: Number(buf.readBigUInt64LE(offset + 1)), size: 9 };
}

/** Strips the SegWit marker/flag/witness data from a full raw tx hex, returning the non-witness serialization — what txid = sha256d(...) is computed over, and exactly what the circuit's `tx` parameter expects. Handles legacy (non-SegWit) transactions too (a no-op skip of the marker/flag/witness steps). */
export function stripWitness(rawHex: string): Buffer {
  const buf = Buffer.from(rawHex, "hex");
  let offset = 0;
  const version = buf.subarray(offset, offset + 4);
  offset += 4;

  let isSegwit = false;
  if (buf[offset] === 0x00 && buf[offset + 1] === 0x01) {
    isSegwit = true;
    offset += 2;
  }

  const inputCountVi = readVarInt(buf, offset);
  const inputCountBytes = buf.subarray(offset, offset + inputCountVi.size);
  offset += inputCountVi.size;

  const inputsStart = offset;
  for (let i = 0; i < inputCountVi.value; i++) {
    offset += 32 + 4; // prevout txid + vout
    const scriptSigLenVi = readVarInt(buf, offset);
    offset += scriptSigLenVi.size + scriptSigLenVi.value;
    offset += 4; // sequence
  }
  const inputsBytes = buf.subarray(inputsStart, offset);

  const outputCountVi = readVarInt(buf, offset);
  const outputCountBytes = buf.subarray(offset, offset + outputCountVi.size);
  offset += outputCountVi.size;

  const outputsStart = offset;
  for (let i = 0; i < outputCountVi.value; i++) {
    offset += 8; // value
    const scriptPubKeyLenVi = readVarInt(buf, offset);
    offset += scriptPubKeyLenVi.size + scriptPubKeyLenVi.value;
  }
  const outputsBytes = buf.subarray(outputsStart, offset);

  if (isSegwit) {
    for (let i = 0; i < inputCountVi.value; i++) {
      const witnessCountVi = readVarInt(buf, offset);
      offset += witnessCountVi.size;
      for (let j = 0; j < witnessCountVi.value; j++) {
        const itemLenVi = readVarInt(buf, offset);
        offset += itemLenVi.size + itemLenVi.value;
      }
    }
  }

  const locktime = buf.subarray(offset, offset + 4);
  offset += 4;

  if (offset !== buf.length) {
    throw new TemplateMismatchError(`raw tx parse mismatch: consumed ${offset} of ${buf.length} bytes`);
  }
  return Buffer.concat([version, inputCountBytes, inputsBytes, outputCountBytes, outputsBytes, locktime]);
}

/** Validates `tx` matches btc_deposit's fixed template exactly and extracts (recipient, amountSats) — mirrors bitcoin.nr's `parse_deposit_tx` assertions byte-for-byte, so a mismatched tx fails here with a specific reason instead of a doomed proving attempt. The OP_RETURN push is a 32-byte "address as bytes32": 12 zero-padding bytes followed by the 20-byte EVM recipient address. */
export function parseDepositTx(tx: Buffer): { recipient: `0x${string}`; amountSats: bigint } {
  if (tx.length !== TX_SIZE) {
    throw new TemplateMismatchError(`expected a ${TX_SIZE}-byte deposit tx (1 input, 2 outputs), got ${tx.length} bytes`);
  }
  if (tx[4] !== 1) throw new TemplateMismatchError("expected exactly 1 input");
  if (tx[41] !== 0) throw new TemplateMismatchError("expected an empty scriptSig (every SegWit spend has this)");
  if (tx[46] !== 2) throw new TemplateMismatchError("expected exactly 2 outputs");

  for (let i = 0; i < 8; i++) {
    if (tx[47 + i] !== 0) throw new TemplateMismatchError("output 0 (OP_RETURN) must carry 0 value");
  }
  if (tx[55] !== 0x22 || tx[56] !== 0x6a || tx[57] !== 0x20) {
    throw new TemplateMismatchError("output 0 must be OP_RETURN + push32 (recipient)");
  }
  const padding = tx.subarray(58, 70);
  if (!padding.every((b) => b === 0)) {
    throw new TemplateMismatchError("output 0's push32 must be zero-padded (12 bytes) before the 20-byte recipient address");
  }
  const recipient = ("0x" + tx.subarray(70, 90).toString("hex")) as `0x${string}`;

  const amountSats = tx.readBigUInt64LE(90);
  if (tx[98] !== 0x16 || tx[99] !== 0x00 || tx[100] !== 0x14) {
    throw new TemplateMismatchError("output 1 must be a P2WPKH payment (0014 + 20-byte hash)");
  }
  const destHash = tx.subarray(101, 121).toString("hex");
  if (destHash !== VAULT_PUBKEY_HASH) {
    throw new TemplateMismatchError(`output 1 must pay the vault address (expected ${VAULT_PUBKEY_HASH}, got ${destHash})`);
  }

  return { recipient, amountSats };
}

interface MempoolBlockStatus {
  block_height: number;
  confirmed: boolean;
}
interface MempoolTx {
  status: MempoolBlockStatus;
}
interface MempoolBlock {
  merkle_root: string;
}
interface MempoolMerkleProof {
  block_height: number;
  merkle: string[];
  pos: number;
}

/**
 * Assembles every input btc_deposit's circuit needs for `txid`, given the
 * currently-registered on-chain checkpoint height. Requires `txid`'s
 * confirming block to be EXACTLY `checkpointHeight + K` — a fixed,
 * disclosed v1 constraint (see BTC_DEPOSIT_DESIGN.md's "Fixed
 * header-chain length, K = 6"), not something this function can route
 * around; a caller whose tx doesn't align yet must wait for the
 * checkpoint to advance (see scripts/refresh-btc-checkpoint.ts) or for
 * more confirmations.
 */
export async function assembleDepositProofInputs(txid: string, checkpointHeight: number): Promise<BtcDepositCircuitInputs> {
  const txInfo = await mempoolGetJson<MempoolTx>(`/tx/${txid}`);
  if (!txInfo.status.confirmed) throw new TemplateMismatchError(`${txid} is not yet confirmed`);
  const txHeight = txInfo.status.block_height;
  const expectedHeight = checkpointHeight + K;
  if (txHeight !== expectedHeight) {
    throw new TemplateMismatchError(
      `${txid} confirmed at height ${txHeight}, but the current checkpoint (${checkpointHeight}) needs it at exactly ${expectedHeight} ` +
        `(K=${K} headers past the checkpoint) — refresh the checkpoint or wait for more confirmations`
    );
  }

  const checkpointHashDisplay = await mempoolGet(`/block-height/${checkpointHeight}`);
  const checkpointHash = reverseHex(checkpointHashDisplay.trim());

  const headers: string[] = [];
  for (let h = checkpointHeight + 1; h <= checkpointHeight + K; h++) {
    const hash = (await mempoolGet(`/block-height/${h}`)).trim();
    const headerHex = (await mempoolGet(`/block/${hash}/header`)).trim();
    if (Buffer.from(headerHex, "hex").length !== HEADER_SIZE) {
      throw new MempoolFetchError(`header at height ${h} was not ${HEADER_SIZE} bytes`);
    }
    headers.push(headerHex);
  }

  const rawTxHex = (await mempoolGet(`/tx/${txid}/hex`)).trim();
  const tx = stripWitness(rawTxHex);
  const { recipient, amountSats } = parseDepositTx(tx);

  const merkleProof = await mempoolGetJson<MempoolMerkleProof>(`/tx/${txid}/merkle-proof`);
  const actualDepth = merkleProof.merkle.length;
  if (actualDepth > MAX_MERKLE_DEPTH) {
    throw new TemplateMismatchError(`Merkle path depth ${actualDepth} exceeds MAX_MERKLE_DEPTH (${MAX_MERKLE_DEPTH})`);
  }
  const merklePathElements: string[] = merkleProof.merkle.map(reverseHex);
  let pos = merkleProof.pos;
  const merklePathIndices: boolean[] = [];
  for (let i = 0; i < actualDepth; i++) {
    merklePathIndices.push(pos % 2 === 1);
    pos = Math.floor(pos / 2);
  }
  while (merklePathElements.length < MAX_MERKLE_DEPTH) merklePathElements.push("00".repeat(32));
  while (merklePathIndices.length < MAX_MERKLE_DEPTH) merklePathIndices.push(false);

  // Defensive cross-check: the tip header's own merkle_root (as reported
  // independently by the block-info endpoint) must match what's embedded
  // in the header bytes we already fetched — catches an inconsistent
  // mempool.space response before it ever reaches the (much slower)
  // proving step.
  const tipBlockHash = (await mempoolGet(`/block-height/${expectedHeight}`)).trim();
  const tipBlockInfo = await mempoolGetJson<MempoolBlock>(`/block/${tipBlockHash}`);
  const tipHeaderBytes = Buffer.from(headers[K - 1], "hex");
  const embeddedMerkleRoot = tipHeaderBytes.subarray(36, 68).toString("hex");
  const reportedMerkleRoot = reverseHex(tipBlockInfo.merkle_root);
  if (embeddedMerkleRoot !== reportedMerkleRoot) {
    throw new MempoolFetchError(`header/block merkle_root mismatch at height ${expectedHeight} — inconsistent mempool.space response`);
  }

  logger.info(`[btc-deposit] assembled proof inputs for ${txid}: height=${txHeight}, recipient=${recipient}, amountSats=${amountSats}, depth=${actualDepth}`);

  return {
    checkpointHash,
    headers,
    tx: tx.toString("hex"),
    merklePathElements,
    merklePathIndices,
    merkleActualDepth: actualDepth,
    recipient,
    amountSats: amountSats.toString(),
  };
}

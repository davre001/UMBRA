import { randomUUID } from "crypto";
import { logger } from "../shared/logger";
import type { BtcDepositRecord } from "./types";

/**
 * In-memory only, deliberately — a simpler v1 boundary than dark-engine's
 * Turso-backed store.ts. Unlike a resting dark-pool order (which can sit
 * for an arbitrary time waiting for a counterparty), a BTC deposit record
 * only needs to survive the short window between submission and a worker
 * picking it up (then the auto-minter picking up the resulting proof) —
 * Render's free-tier idle restarts are a real risk for that window too,
 * but wiring the same Turso persistence dark-engine uses is a mechanical,
 * low-risk follow-up (same JSON.stringify/bigint-replacer pattern), not
 * something this phase needed to duplicate to prove the btc-deposit flow
 * works. Disclosed here rather than left implicit. `minter.ts`'s own
 * defensive on-chain `isSpentNullifier` check is what actually protects
 * against a lost-record double-mint attempt across a restart, independent
 * of this in-memory limitation.
 */
const records = new Map<string, BtcDepositRecord>();
// A given real Bitcoin txid should only ever have one deposit record.
// Unlike the old private-note design, `recipient` is read straight off the
// confirmed transaction (not user-supplied), so resubmitting the same txid
// is always idempotent — there is no conflicting-secret case to guard
// against anymore.
const txidToId = new Map<string, string>();

export function createRecord(input: { txid: string; checkpointHeight: number; recipient: `0x${string}`; amountSats: string }): BtcDepositRecord {
  const existingId = txidToId.get(input.txid);
  if (existingId) {
    const existing = records.get(existingId);
    if (existing) {
      // checkpointHeight is captured once at submission time and never
      // otherwise revisited (assembleDepositProofInputs trusts whatever
      // the record already has, not a fresh lookup) — so a record
      // submitted while an older checkpoint was live stays permanently
      // stuck even after the checkpoint is refreshed to the value that
      // would actually match its real confirming height, with no way to
      // recover it. Safe to just refresh this bookkeeping field on
      // resubmission rather than leaving the record unprovable forever —
      // but only while it's still awaiting_proof; a proven/minted/failed
      // record is a terminal result, not something a resubmission should
      // silently mutate.
      if (existing.status === "awaiting_proof" && existing.checkpointHeight !== input.checkpointHeight) {
        logger.info(
          `[btc-deposit] ${input.txid}: refreshing stale checkpointHeight on record ${existingId} (${existing.checkpointHeight} -> ${input.checkpointHeight})`
        );
        existing.checkpointHeight = input.checkpointHeight;
      }
      logger.info(`[btc-deposit] ${input.txid}: already submitted as ${existingId} (${existing.status}) — returning existing record`);
      return existing;
    }
  }
  const record: BtcDepositRecord = {
    id: randomUUID(),
    txid: input.txid,
    checkpointHeight: input.checkpointHeight,
    recipient: input.recipient,
    amountSats: input.amountSats,
    status: "awaiting_proof",
    submittedAt: Date.now(),
  };
  records.set(record.id, record);
  txidToId.set(input.txid, record.id);
  logger.info(`[btc-deposit] ${input.txid}: submitted as ${record.id} (recipient ${input.recipient})`);
  return record;
}

export function getRecord(id: string): BtcDepositRecord | undefined {
  return records.get(id);
}

export function listAwaitingProof(): BtcDepositRecord[] {
  return [...records.values()].filter((r) => r.status === "awaiting_proof");
}

/** Proven-but-not-yet-minted records — what minter.ts's poll loop retries. */
export function listProven(): BtcDepositRecord[] {
  return [...records.values()].filter((r) => r.status === "proven");
}

export function markProven(id: string, proof: `0x${string}`, publicInputs: [string, string, string, string]): BtcDepositRecord | undefined {
  const record = records.get(id);
  if (!record) return undefined;
  record.status = "proven";
  record.proof = proof;
  record.publicInputs = publicInputs;
  logger.info(`[btc-deposit] ${record.txid}: proven (record ${id})`);
  return record;
}

export function markMinted(id: string, mintTxHash: `0x${string}` | undefined): BtcDepositRecord | undefined {
  const record = records.get(id);
  if (!record) return undefined;
  record.status = "minted";
  record.mintTxHash = mintTxHash;
  logger.info(`[btc-deposit] ${record.txid}: minted (record ${id})${mintTxHash ? ` tx ${mintTxHash}` : " (recovered — already minted on-chain)"}`);
  return record;
}

export function markFailed(id: string, reason: string): BtcDepositRecord | undefined {
  const record = records.get(id);
  if (!record) return undefined;
  record.status = "failed";
  record.failureReason = reason;
  logger.warn(`[btc-deposit] ${record.txid}: failed (record ${id}): ${reason}`);
  return record;
}

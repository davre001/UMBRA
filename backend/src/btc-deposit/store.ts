import { randomUUID } from "crypto";
import { logger } from "../shared/logger";
import type { BtcDepositRecord } from "./types";

/**
 * In-memory only, deliberately — a simpler v1 boundary than dark-engine's
 * Turso-backed store.ts. Unlike a resting dark-pool order (which can sit
 * for an arbitrary time waiting for a counterparty), a BTC deposit record
 * only needs to survive the short window between submission and a worker
 * picking it up — Render's free-tier idle restarts are a real risk for
 * that window too, but wiring the same Turso persistence dark-engine uses
 * is a mechanical, low-risk follow-up (same JSON.stringify/bigint-replacer
 * pattern), not something this phase needed to duplicate to prove the
 * btc-deposit flow works. Disclosed here rather than left implicit.
 */
/**
 * Thrown by createRecord when `txid` was already submitted with a
 * DIFFERENT blinding than this call's. Since `note_commitment =
 * Poseidon(assetId, amount, ownerKey, blinding)`, whichever blinding gets
 * stored first is the one the worker will actually prove and mint against
 * — a real depositor's own later /submit call (their tx is public on
 * signet the moment it confirms, so anyone can race to submit it first
 * with a garbage blinding) must never have its blinding silently
 * discarded in favor of an already-stored one, since that mints a note
 * the real depositor can never produce a valid spend proof for. This
 * can't be prevented outright without an auth/commit-reveal scheme (see
 * BTC_DEPOSIT_DESIGN.md), but a loud, explicit conflict here at least
 * turns "silently bricked note" into "visible, retryable error."
 */
export class BlindingMismatchError extends Error {
  constructor(txid: string) {
    super(`${txid} was already submitted with a different blinding — refusing to silently discard yours`);
  }
}

const records = new Map<string, BtcDepositRecord>();
// A given real Bitcoin txid should only ever have one deposit record —
// resubmitting the same txid with the SAME blinding (e.g. a retried
// frontend request) returns the existing record instead of creating a
// doomed duplicate; resubmitting with a DIFFERENT blinding throws (see
// BlindingMismatchError) rather than silently overriding or discarding.
const txidToId = new Map<string, string>();

export function createRecord(input: {
  txid: string;
  checkpointHeight: number;
  ownerKey: string;
  amountSats: string;
  blinding: string;
}): BtcDepositRecord {
  const existingId = txidToId.get(input.txid);
  if (existingId) {
    const existing = records.get(existingId);
    if (existing) {
      if (existing.blinding !== input.blinding) {
        logger.warn(`[btc-deposit] ${input.txid}: resubmitted with a different blinding than record ${existingId} — rejecting`);
        throw new BlindingMismatchError(input.txid);
      }
      // checkpointHeight is captured once at submission time and never
      // otherwise revisited (assembleDepositProofInputs trusts whatever
      // the record already has, not a fresh lookup) — so a record
      // submitted while an older checkpoint was live stays permanently
      // stuck even after the checkpoint is refreshed to the value that
      // would actually match its real confirming height, with no way to
      // recover it. Same blinding means the same legitimate depositor
      // (an attacker can't produce it), so it's safe to just refresh this
      // bookkeeping field on resubmission rather than leaving the record
      // unprovable forever — but only while it's still awaiting_proof;
      // a proven/failed record is a terminal result, not something a
      // resubmission should silently mutate.
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
    ownerKey: input.ownerKey,
    amountSats: input.amountSats,
    blinding: input.blinding,
    status: "awaiting_proof",
    submittedAt: Date.now(),
  };
  records.set(record.id, record);
  txidToId.set(input.txid, record.id);
  logger.info(`[btc-deposit] ${input.txid}: submitted as ${record.id}`);
  return record;
}

export function getRecord(id: string): BtcDepositRecord | undefined {
  return records.get(id);
}

export function listAwaitingProof(): BtcDepositRecord[] {
  return [...records.values()].filter((r) => r.status === "awaiting_proof");
}

export function markProven(id: string, proof: `0x${string}`, publicInputs: [string, string, string]): BtcDepositRecord | undefined {
  const record = records.get(id);
  if (!record) return undefined;
  record.status = "proven";
  record.proof = proof;
  record.publicInputs = publicInputs;
  logger.info(`[btc-deposit] ${record.txid}: proven (record ${id})`);
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

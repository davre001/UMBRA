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
const records = new Map<string, BtcDepositRecord>();
// A given real Bitcoin txid should only ever have one deposit record —
// resubmitting the same txid (e.g. a retried frontend request) returns the
// existing record instead of creating a doomed duplicate.
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

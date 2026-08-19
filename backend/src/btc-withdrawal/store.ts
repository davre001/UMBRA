import { createClient, type Client } from "@libsql/client";
import { logger } from "../shared/logger";
import type { BtcWithdrawalRequest } from "./types";

/**
 * Durable backing store for BTC withdrawal fulfillment state — same
 * Turso-backed pattern `dark-engine/store.ts` already uses, and for the
 * same underlying reason: Render's free web-service plan has no
 * persistent disk, so anything living only in this process's memory is
 * lost on every idle-triggered restart. For most modules in this repo
 * that's an inconvenience; here it was a real correctness gap — a restart
 * with an empty in-memory store used to mean the watcher could re-attempt
 * (and double-pay) a withdrawal it had already broadcast before the
 * restart. That gap is what this file closes.
 *
 * `records` and `lastProcessedBlock` remain the hot path for every read
 * during normal operation — Turso is written through on every mutation,
 * then read back once via `hydrate()` at boot, not queried on every
 * request.
 */

const records = new Map<string, BtcWithdrawalRequest>();
let lastProcessedBlock: bigint | null = null;

let client: Client | null = null;
// Same opt-in convention as dark-engine/store.ts: unconfigured (no
// TURSO_DATABASE_URL, or NODE_ENV=test) means every function below is a
// no-op and this module behaves exactly as its earlier in-memory-only
// version did. Local dev and CI shouldn't need a Turso account just to
// run this backend or its test suite.
const configured = Boolean(process.env.TURSO_DATABASE_URL) && process.env.NODE_ENV !== "test";

function getClient(): Client {
  if (client) return client;
  client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  return client;
}

export async function initStore(): Promise<void> {
  if (!configured) return;
  const db = getClient();
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS btc_withdrawals (
        nullifier_hash TEXT PRIMARY KEY,
        record TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS btc_withdrawal_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ],
    "write"
  );
}

async function saveRecord(request: BtcWithdrawalRequest): Promise<void> {
  if (!configured) return;
  const db = getClient();
  await db.execute({
    sql: "INSERT INTO btc_withdrawals (nullifier_hash, record) VALUES (?, ?) ON CONFLICT(nullifier_hash) DO UPDATE SET record = excluded.record",
    args: [request.nullifierHash, JSON.stringify(request)],
  });
}

async function saveLastProcessedBlock(block: bigint): Promise<void> {
  if (!configured) return;
  const db = getClient();
  await db.execute({
    sql: "INSERT INTO btc_withdrawal_state (key, value) VALUES ('lastProcessedBlock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [block.toString()],
  });
}

/** Repopulates the in-memory records + lastProcessedBlock from the durable store — call once at boot, before the watcher's first poll cycle. A no-op (same as a fresh in-memory boot always was) when unconfigured. */
export async function hydrate(): Promise<void> {
  if (!configured) {
    logger.warn("[btc-withdrawal] TURSO_DATABASE_URL not set — withdrawal fulfillment state is in-memory only and will be lost on the next restart");
    return;
  }
  await initStore();
  const db = getClient();
  const [recordsResult, stateResult] = await db.batch(
    ["SELECT record FROM btc_withdrawals", "SELECT value FROM btc_withdrawal_state WHERE key = 'lastProcessedBlock'"],
    "read"
  );
  for (const row of recordsResult.rows) {
    const request = JSON.parse(row.record as string) as BtcWithdrawalRequest;
    records.set(request.nullifierHash, request);
  }
  if (stateResult.rows.length > 0) {
    lastProcessedBlock = BigInt(stateResult.rows[0].value as string);
  }
  logger.info(
    `[btc-withdrawal] hydrated from store: ${recordsResult.rows.length} withdrawal record(s), lastProcessedBlock=${lastProcessedBlock ?? "unset"}`
  );
}

export function getRecord(nullifierHash: string): BtcWithdrawalRequest | undefined {
  return records.get(nullifierHash);
}

export async function upsertPending(request: BtcWithdrawalRequest): Promise<void> {
  records.set(request.nullifierHash, request);
  await saveRecord(request);
}

export async function markBroadcast(nullifierHash: string, payoutTxid: string): Promise<void> {
  const record = records.get(nullifierHash);
  if (!record) return;
  record.status = "broadcast";
  record.payoutTxid = payoutTxid;
  record.broadcastAt = Date.now();
  record.psbt = undefined; // fully spent — no reason to keep the staging PSBT around
  logger.info(`[btc-withdrawal] ${nullifierHash}: broadcast as ${payoutTxid}`);
  await saveRecord(record);
}

/** Stages a real spending PSBT against the 2-of-3 reserve — see bitcoin-tx.ts's buildWithdrawalPsbt. Moves the record out of `pending` (so the watcher's own retry loop stops re-staging it every poll) until scripts/sign-btc-withdrawal.ts's signers push it to `broadcast`. */
export async function markAwaitingSignatures(nullifierHash: string, psbtBase64: string): Promise<void> {
  const record = records.get(nullifierHash);
  if (!record) return;
  record.status = "awaiting_signatures";
  record.psbt = psbtBase64;
  logger.info(`[btc-withdrawal] ${nullifierHash}: PSBT staged, awaiting >= threshold reserve signatures`);
  await saveRecord(record);
}

/** Replaces a record's stored PSBT with an updated one (e.g. after combining in another signer's partial signature) — the record must already be `awaiting_signatures`. */
export async function updatePsbt(nullifierHash: string, psbtBase64: string): Promise<void> {
  const record = records.get(nullifierHash);
  if (!record || record.status !== "awaiting_signatures") return;
  record.psbt = psbtBase64;
  await saveRecord(record);
}

export async function markFailed(nullifierHash: string, reason: string): Promise<void> {
  const record = records.get(nullifierHash);
  if (!record) return;
  record.status = "failed";
  record.failureReason = reason;
  logger.error(`[btc-withdrawal] ${nullifierHash}: failed — ${reason}`);
  await saveRecord(record);
}

export function listPending(): BtcWithdrawalRequest[] {
  return [...records.values()].filter((r) => r.status === "pending");
}

/** Every request this process currently knows about, newest first — used by the solvency route to sum outstanding (pending + failed-but-not-yet-resolved) obligations. */
export function listAll(): BtcWithdrawalRequest[] {
  return [...records.values()].sort((a, b) => b.observedAt - a.observedAt);
}

/** Total sats actually broadcast (paid out) since `sinceMs` (a wall-clock timestamp, e.g. `Date.now() - ONE_HOUR_MS`) — what rate-limit.ts's rolling-window cap check sums against. Keyed off `broadcastAt`, not `observedAt`/`requestedAtBlock` — a withdrawal can sit `pending` for a while before it's actually paid out, and the cap is about real outbound payments, not requests. */
export function sumBroadcastSatsSince(sinceMs: number): bigint {
  return [...records.values()]
    .filter((r) => r.status === "broadcast" && r.broadcastAt !== undefined && r.broadcastAt >= sinceMs)
    .reduce((sum, r) => sum + BigInt(r.amountSats), BigInt(0));
}

export function getLastProcessedBlock(): bigint | null {
  return lastProcessedBlock;
}

export async function setLastProcessedBlock(block: bigint): Promise<void> {
  lastProcessedBlock = block;
  await saveLastProcessedBlock(block);
}

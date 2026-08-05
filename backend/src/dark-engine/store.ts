import { createClient, type Client } from "@libsql/client";
import type { MatchRecord, OrderIntent } from "./types";

// MatchRecord.proofInputs is full of real bigints (nullifier hashes, Merkle
// path elements, ...) that JSON.stringify can't handle natively. Marked
// round-trip instead of a plain toString(), so parsing back doesn't need to
// know which specific fields were bigints — anything tagged this way was one.
function replacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? { $bigint: value.toString() } : value;
}
function reviver(_key: string, value: unknown) {
  if (value && typeof value === "object" && "$bigint" in (value as Record<string, unknown>)) {
    return BigInt((value as { $bigint: string }).$bigint);
  }
  return value;
}

/**
 * Durable backing store for the matcher's order book and match records —
 * without this, both live only in the in-memory Maps in matcher.ts, which
 * Render's free web-service plan wipes on every idle-triggered restart (no
 * persistent disk on that plan — see matcher.ts's own comment on why a
 * resubmitted order could otherwise form a doomed duplicate match). Backed
 * by Turso (hosted libSQL) specifically because Render's own disk/KV options
 * either don't persist on the free tier or require a paid plan — Turso's
 * data lives on its own servers, reached over the network, so it survives
 * this service restarting regardless of Render's plan.
 *
 * Every mutation in matcher.ts writes through to here immediately; on boot,
 * `hydrate()` reads everything back to repopulate the in-memory Maps before
 * the server starts accepting requests. The in-memory Maps remain the hot
 * path for every read during normal operation — this is not a replacement
 * for them, just what makes them survive a restart.
 */

let client: Client | null = null;
// Persistence is opt-in via TURSO_DATABASE_URL — local dev shouldn't need a
// Turso account just to run the backend. Unconfigured, every function below
// is a no-op and the matcher behaves exactly as it did before this file
// existed (in-memory only, wiped on restart). Only Render deployments,
// where that actually matters, need the env var set.
//
// Also off under NODE_ENV=test (Vitest's default) even if a real
// TURSO_DATABASE_URL happens to be present in .env for local dev — dark-
// engine.test.ts submits orders with throwaway fake commitments against
// whatever this env var points at, and that's the same database production
// uses if backend/.env and Render's env vars were copied from each other.
// Tests should never be able to leave garbage rows in a database real
// traffic also reads from.
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
      `CREATE TABLE IF NOT EXISTS resting_orders (
        commitment TEXT PRIMARY KEY,
        intent TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        record TEXT NOT NULL
      )`,
    ],
    "write"
  );
}

/** Every resting order + every match record, exactly as last written — matcher.ts's `hydrateFromStore` uses this to rebuild the in-memory book, matches map, and commitment→matchId index on boot. Empty when unconfigured, same as a fresh in-memory boot always was. */
export async function loadAll(): Promise<{ orders: OrderIntent[]; matches: MatchRecord[] }> {
  if (!configured) return { orders: [], matches: [] };
  const db = getClient();
  const [ordersResult, matchesResult] = await db.batch(["SELECT intent FROM resting_orders", "SELECT record FROM matches"], "read");
  const orders = ordersResult.rows.map((row) => JSON.parse(row.intent as string, reviver) as OrderIntent);
  const matches = matchesResult.rows.map((row) => JSON.parse(row.record as string, reviver) as MatchRecord);
  return { orders, matches };
}

export async function saveOrder(order: OrderIntent): Promise<void> {
  if (!configured) return;
  const db = getClient();
  await db.execute({
    sql: "INSERT INTO resting_orders (commitment, intent) VALUES (?, ?) ON CONFLICT(commitment) DO UPDATE SET intent = excluded.intent",
    args: [order.commitment, JSON.stringify(order, replacer)],
  });
}

/** Removes a resting order once it's claimed for a match (or cancelled) — it either lives on in a match record from here, or is gone entirely. */
export async function deleteOrder(commitment: string): Promise<void> {
  if (!configured) return;
  const db = getClient();
  await db.execute({ sql: "DELETE FROM resting_orders WHERE commitment = ?", args: [commitment] });
}

/** Upserts a match record — called after every mutation to a MatchRecord (creation, status transitions, announcement flags) so a restart mid-flow resumes from the exact same state. */
export async function saveMatch(record: MatchRecord): Promise<void> {
  if (!configured) return;
  const db = getClient();
  await db.execute({
    sql: "INSERT INTO matches (id, record) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record",
    args: [record.id, JSON.stringify(record, replacer)],
  });
}

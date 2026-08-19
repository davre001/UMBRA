import * as store from "./store";
import type { BtcWithdrawalRequest } from "./types";

/**
 * Flags withdrawal requests stuck in `pending` or `awaiting_signatures`
 * longer than expected — the observable signal for the open gap this
 * closes the cheap half of: if the custodian key holder or enough of the
 * 2-of-3 reserve signers (see reserve.ts) go dark, a withdrawal just sits
 * forever with no on-chain-visible symptom — `ExternalWithdrawalRequested`
 * looks identical on Bitcoin's own explorers whether fulfillment is merely
 * slow or has stalled for good. This module doesn't *fix* that (no
 * automatic reclaim or payout timeout exists yet — see LIMITATIONS.md and
 * docs/RUNBOOK_BTC_WITHDRAWAL.md for the deliberate reasons why, and what
 * to do by hand when this fires), it only makes the gap loudly checkable
 * before a user has to ask "where's my BTC".
 *
 * `broadcast` records are done and excluded. `failed` records are excluded
 * too — solvency.ts's report already counts those separately, and a
 * `failed` record needs a different response (read failureReason, don't
 * just wait longer) than an overdue `pending`/`awaiting_signatures` one.
 */

const DEFAULT_OVERDUE_MS = 6 * 60 * 60 * 1000; // 6h — generous relative to the sweep loop's poll cadence and real human signer coordination time, tight enough to page someone same-day.

export function getOverdueThresholdMs(): number {
  const raw = process.env.BTC_WITHDRAWAL_OVERDUE_MS;
  if (!raw) return DEFAULT_OVERDUE_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`BTC_WITHDRAWAL_OVERDUE_MS must be a positive number of milliseconds, got ${JSON.stringify(raw)}`);
  }
  return value;
}

export interface OverdueEntry {
  nullifierHash: string;
  status: BtcWithdrawalRequest["status"];
  amountSats: string;
  ageMs: number;
}

/** `now` is an injectable param (not just `Date.now()` internally) purely so tests can assert exact age boundaries without faking the system clock. */
export function listOverdue(now: number = Date.now()): OverdueEntry[] {
  const thresholdMs = getOverdueThresholdMs();
  return store
    .listAll()
    .filter((r) => (r.status === "pending" || r.status === "awaiting_signatures") && now - r.observedAt >= thresholdMs)
    .map((r) => ({ nullifierHash: r.nullifierHash, status: r.status, amountSats: r.amountSats, ageMs: now - r.observedAt }));
}

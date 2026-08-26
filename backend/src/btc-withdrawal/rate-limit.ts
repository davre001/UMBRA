import * as store from "./store";

/**
 * Bounds how much real signet BTC the custodian key can pay out in a
 * rolling window, independent of solvency.ts's own balance check —
 * solvency answers "can pending withdrawals be paid right now", this
 * answers "should this one be paid *right now*, or should it wait". The
 * threat this closes: if `BTC_CUSTODIAN_WIF` leaks (see wallet.ts's own
 * NatSpec — that key's compromise is this bridge's single biggest
 * remaining blast radius), the attacker can still request withdrawals, but
 * can no longer drain the whole custodian balance in one shot — they're
 * capped to whatever these windows allow, same "make dishonesty/theft
 * slow and visible, not impossible" philosophy solvency.ts already
 * documents for its own check.
 *
 * Both caps are optional and independent — set either, both, or neither.
 * Unset means uncapped (logged once at first use, same disclosure
 * convention as wallet.ts's "PRIVATE_KEY not set" warnings elsewhere in
 * this backend) — this is a deliberate opt-in, not a default, since an
 * operator who hasn't thought about real payout volume yet shouldn't have
 * withdrawals silently stall against an arbitrary default cap.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface RateCapConfig {
  maxSatsPerHour?: bigint;
  maxSatsPerDay?: bigint;
}

function readCapEnv(name: string): bigint | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    throw new Error(`${name} must be a non-negative integer of sats, got ${JSON.stringify(raw)}`);
  }
  if (value <= BigInt(0)) throw new Error(`${name} must be a positive integer of sats, got ${raw}`);
  return value;
}

export function getRateCapConfig(): RateCapConfig {
  return {
    maxSatsPerHour: readCapEnv("BTC_WITHDRAWAL_MAX_SATS_PER_HOUR"),
    maxSatsPerDay: readCapEnv("BTC_WITHDRAWAL_MAX_SATS_PER_DAY"),
  };
}

/** The window is currently full, but real time passing will free it up — same "leave pending, retry later" treatment attemptFulfillment already gives InsufficientFundsError. */
export class RateCapTemporarilyExceededError extends Error {}

/** `amountSats` alone exceeds a configured cap — no amount of waiting fixes this (the window can never hold it), so this is a permanent, distinct failure rather than an endlessly-retried one. */
export class RateCapPermanentlyExceededError extends Error {}

interface CapCheck {
  label: string;
  windowMs: number;
  cap: bigint;
}

/**
 * Throws if broadcasting `amountSats` right now would push either
 * configured rolling window over its cap. Call this before signing/
 * broadcasting, not after — same "check first" ordering
 * `buildAndSignWithdrawal`'s own UTXO selection already follows for
 * solvency.
 */
export function assertWithinRateCap(amountSats: bigint): void {
  const config = getRateCapConfig();
  const checks: CapCheck[] = [];
  if (config.maxSatsPerHour !== undefined) checks.push({ label: "hourly", windowMs: HOUR_MS, cap: config.maxSatsPerHour });
  if (config.maxSatsPerDay !== undefined) checks.push({ label: "daily", windowMs: DAY_MS, cap: config.maxSatsPerDay });
  if (checks.length === 0) return;

  const now = Date.now();
  for (const { label, windowMs, cap } of checks) {
    if (amountSats > cap) {
      throw new RateCapPermanentlyExceededError(
        `${label} cap is ${cap} sats — this withdrawal alone (${amountSats} sats) exceeds it and can never be paid under the current cap`
      );
    }
    const spent = store.sumBroadcastSatsSince(now - windowMs);
    if (spent + amountSats > cap) {
      throw new RateCapTemporarilyExceededError(
        `${label} cap ${cap} sats: already broadcast ${spent} in the trailing window, this withdrawal (${amountSats}) would exceed it — will retry once the window frees up`
      );
    }
  }
}

/** Read-only snapshot for the solvency report — same "make this independently checkable" goal solvency.ts's own report already follows. */
export interface RateCapStatus {
  maxSatsPerHour: string | null;
  spentSatsLastHour: string;
  maxSatsPerDay: string | null;
  spentSatsLastDay: string;
}

export function getRateCapStatus(): RateCapStatus {
  const config = getRateCapConfig();
  const now = Date.now();
  return {
    maxSatsPerHour: config.maxSatsPerHour?.toString() ?? null,
    spentSatsLastHour: store.sumBroadcastSatsSince(now - HOUR_MS).toString(),
    maxSatsPerDay: config.maxSatsPerDay?.toString() ?? null,
    spentSatsLastDay: store.sumBroadcastSatsSince(now - DAY_MS).toString(),
  };
}

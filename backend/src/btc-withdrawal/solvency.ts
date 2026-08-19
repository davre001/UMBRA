import { getCustodianAddress } from "./wallet";
import { getReserveAddress } from "./reserve";
import { fetchConfirmedBalanceSats } from "./mempool";
import { getRateCapStatus, type RateCapStatus } from "./rate-limit";
import { listOverdue } from "./overdue";
import * as store from "./store";

/**
 * The real, independently-checkable solvency question: does real, currently
 * held BTC cover every withdrawal that's already been nullified on-chain
 * but not yet paid out? This is deliberately NOT a running "total ever
 * minted minus total ever withdrawn" ledger — even though `ExternalDeposited`
 * now emits a plaintext `amount` (deposits mint real public WrappedBTC, not
 * a hidden note — see ShieldedVault.sol), that total says nothing about
 * whether real signet BTC can cover it right now, since WrappedBTC can move
 * through `shield`/`pay`/the dark pool long after minting with no on-chain
 * link back to any specific deposit. Comparing real balance against
 * *outstanding withdrawal obligations* — not a historical mint total — is
 * what actually answers "can pending withdrawals be paid right now."
 *
 * Two balances now, not one: since sweep.ts moves confirmed hot-wallet
 * funds into the 2-of-3 reserve (see reserve.ts) and every real payout
 * funds FROM the reserve, not the hot wallet directly, "the custodian's
 * balance" alone would understate real coverage once a sweep has run —
 * this sums both, since either can cover an outstanding obligation
 * depending on exactly when in the sweep cycle a check happens.
 *
 * Anyone can independently verify this themselves without trusting this
 * backend's own arithmetic: both addresses are public (getCustodianAddress/
 * getReserveAddress), their real balances are free to query via
 * mempool.space directly, and every `ExternalWithdrawalRequested` event is
 * public on-chain — this function's only job is to save that work, not to
 * be the sole source of truth for it.
 */
export interface SolvencyReport {
  custodianAddress: string;
  custodianBalanceSats: string;
  reserveAddress: string;
  reserveBalanceSats: string;
  totalBalanceSats: string;
  outstandingObligationSats: string;
  solvent: boolean;
  pendingCount: number;
  /** Staged PSBTs awaiting >= threshold reserve signatures — see types.ts's own doc on this status. */
  awaitingSignaturesCount: number;
  failedCount: number;
  /** Count of `pending`/`awaiting_signatures` records older than overdue.ts's threshold — see that module's own doc for exactly what gap this surfaces (and doesn't close). */
  overdueCount: number;
  /** Age in ms of the single oldest overdue record, or null if none — the number worth alerting/paging on, since one very stale withdrawal matters more than the raw count. */
  oldestOverdueMs: number | null;
  /** Same "make it independently checkable" goal as the fields above, applied to rate-limit.ts's own payout throttle — see that module's own doc for what this does and doesn't protect against. */
  rateCap: RateCapStatus;
}

export async function computeSolvency(): Promise<SolvencyReport> {
  const custodianAddress = getCustodianAddress();
  const reserveAddress = getReserveAddress();
  const [custodianBalance, reserveBalance] = await Promise.all([
    fetchConfirmedBalanceSats(custodianAddress),
    fetchConfirmedBalanceSats(reserveAddress),
  ]);
  const totalBalance = custodianBalance + reserveBalance;

  const all = store.listAll();
  const pending = all.filter((r) => r.status === "pending");
  const awaitingSignatures = all.filter((r) => r.status === "awaiting_signatures");
  const failed = all.filter((r) => r.status === "failed");
  const outstanding = [...pending, ...awaitingSignatures, ...failed].reduce((sum, r) => sum + BigInt(r.amountSats), BigInt(0));

  const overdue = listOverdue();
  const oldestOverdueMs = overdue.length === 0 ? null : Math.max(...overdue.map((e) => e.ageMs));

  return {
    custodianAddress,
    custodianBalanceSats: custodianBalance.toString(),
    reserveAddress,
    reserveBalanceSats: reserveBalance.toString(),
    totalBalanceSats: totalBalance.toString(),
    outstandingObligationSats: outstanding.toString(),
    solvent: totalBalance >= outstanding,
    pendingCount: pending.length,
    awaitingSignaturesCount: awaitingSignatures.length,
    failedCount: failed.length,
    overdueCount: overdue.length,
    oldestOverdueMs,
    rateCap: getRateCapStatus(),
  };
}

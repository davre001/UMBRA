import { getCustodianAddress } from "./wallet";
import { fetchConfirmedBalanceSats } from "./mempool";
import * as store from "./store";

/**
 * The real, independently-checkable solvency question: does the custodian
 * currently hold enough real BTC to cover every withdrawal that's already
 * been nullified on-chain but not yet paid out? This is deliberately NOT a
 * running "total ever minted minus total ever withdrawn" ledger — even
 * though `ExternalDeposited` now emits a plaintext `amount` (deposits mint
 * real public WrappedBTC, not a hidden note — see ShieldedVault.sol), that
 * total says nothing about whether the custodian's real signet balance can
 * cover it right now, since WrappedBTC can move through `shield`/`pay`/the
 * dark pool long after minting with no on-chain link back to any specific
 * deposit. Comparing real balance against *outstanding withdrawal
 * obligations* — not a historical mint total — is what actually answers
 * "can pending withdrawals be paid right now," which is what anyone
 * deciding whether to trust a pending request actually wants to know.
 *
 * Anyone can independently verify this themselves without trusting this
 * backend's own arithmetic: the custodian address is public
 * (getCustodianAddress), its real balance is free to query via
 * mempool.space directly, and every `ExternalWithdrawalRequested` event is
 * public on-chain — this function's only job is to save that work, not to
 * be the sole source of truth for it.
 */
export interface SolvencyReport {
  custodianAddress: string;
  custodianBalanceSats: string;
  outstandingObligationSats: string;
  solvent: boolean;
  pendingCount: number;
  failedCount: number;
}

export async function computeSolvency(): Promise<SolvencyReport> {
  const custodianAddress = getCustodianAddress();
  const balance = await fetchConfirmedBalanceSats(custodianAddress);

  const all = store.listAll();
  const pending = all.filter((r) => r.status === "pending");
  const failed = all.filter((r) => r.status === "failed");
  const outstanding = [...pending, ...failed].reduce((sum, r) => sum + BigInt(r.amountSats), BigInt(0));

  return {
    custodianAddress,
    custodianBalanceSats: balance.toString(),
    outstandingObligationSats: outstanding.toString(),
    solvent: balance >= outstanding,
    pendingCount: pending.length,
    failedCount: failed.length,
  };
}

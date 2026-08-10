import { getCustodianAddress } from "./wallet";
import { fetchConfirmedBalanceSats } from "./mempool";
import * as store from "./store";

/**
 * The real, independently-checkable solvency question: does the custodian
 * currently hold enough real BTC to cover every withdrawal that's already
 * been nullified on-chain but not yet paid out? This is deliberately NOT a
 * running "total ever minted minus total ever withdrawn" ledger — that
 * figure can't actually be computed on-chain for the deposit side: a BTC
 * deposit's amount is hidden inside its Poseidon2 note_commitment by
 * design (the whole point of the shielded pool), so `ExternalDeposited`
 * never emits a plaintext amount to sum. (`ExternalWithdrawalRequested`'s
 * `amount` IS plaintext — same reason `withdraw`'s amount is public for
 * every other asset too, see circuits/DESIGN.md's "Known simplification,
 * v1".) Comparing real balance against *outstanding obligations* — not a
 * historical total — is both the achievable computation and the more
 * directly useful one: it answers "can pending withdrawals actually be
 * paid right now," which is what anyone deciding whether to trust a
 * pending request actually wants to know.
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

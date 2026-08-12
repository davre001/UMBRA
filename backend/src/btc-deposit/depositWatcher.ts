import * as bitcoin from "bitcoinjs-lib";
import { logger } from "../shared/logger";
import { SIGNET_NETWORK } from "../btc-withdrawal/wallet";
import { mempoolGet, VAULT_PUBKEY_HASH, stripWitness, parseDepositTx } from "./mempool";
import { getCurrentCheckpointHeight } from "./checkpoint";
import * as store from "./store";

/**
 * Self-registration backstop for deposits whose depositor never called
 * POST /submit — closes a real, narrow gap in the auto-deposit flow
 * (frontend/src/app/faucet/page.tsx's BtcFaucetCard): that flow first
 * broadcasts the signed Bitcoin tx (irreversibly moving the depositor's
 * BTC to the vault), then separately reports the txid here so it can be
 * proven and minted. If the browser tab closes, loses connectivity, or
 * crashes in the gap between those two steps, the BTC has already left
 * the depositor's wallet, but this backend never learns the txid exists
 * — the deposited UTXO is now spent, so nothing about the depositor's own
 * signet address ever points back to it, and it would otherwise never
 * become WrappedBTC.
 *
 * This watcher closes that gap the same way btc-withdrawal/watcher.ts
 * closes the equivalent one on the payout side: independently scan the
 * one address that matters (here, the vault's own deposit address) rather
 * than trusting a single client-reported call. Every candidate transaction
 * goes through the exact same parse/validate path
 * btc-deposit.routes.ts's POST /submit already uses
 * (parseDepositTx against the fixed OP_RETURN+P2WPKH template), so a
 * transaction that doesn't match the template (a withdrawal payout's own
 * funding tx, dust, anything else paying this address) is silently
 * skipped, not misregistered. store.createRecord is itself idempotent per
 * txid, so re-registering an already-known deposit here on every poll is
 * a harmless no-op — this file only exists to catch the ones that
 * wouldn't otherwise be registered at all.
 */

let cachedVaultAddress: string | null = null;

/** The vault's own signet deposit address, derived from the public VAULT_PUBKEY_HASH — deliberately not from btc-withdrawal/wallet.ts's getCustodianAddress(), which requires the custodian's actual private key (BTC_CUSTODIAN_WIF). This watcher only ever reads chain data, so it must not require a signing key to run. */
function getVaultAddress(): string {
  if (cachedVaultAddress) return cachedVaultAddress;
  const { address } = bitcoin.payments.p2wpkh({ hash: Buffer.from(VAULT_PUBKEY_HASH, "hex"), network: SIGNET_NETWORK });
  if (!address) throw new Error("Failed to derive the vault's signet address from BTC_VAULT_PUBKEY_HASH");
  cachedVaultAddress = address;
  return address;
}

interface MempoolAddressTx {
  txid: string;
}

/**
 * One pass: fetch the vault address's recent transactions (mempool.space's
 * /address/:address/txs — unconfirmed plus the most recent confirmed ones,
 * which is exactly the recency window a mid-flight tab close needs, not a
 * full historical backfill), and self-register any that match the deposit
 * template and aren't already known to store.ts.
 */
export async function pollOnce(): Promise<{ scanned: number; registered: number }> {
  const checkpointHeight = getCurrentCheckpointHeight();
  if (checkpointHeight === undefined) {
    logger.debug("[btc-deposit-watcher] no checkpoint registered yet — skipping this tick");
    return { scanned: 0, registered: 0 };
  }

  const vaultAddress = getVaultAddress();
  const txs = JSON.parse(await mempoolGet(`/address/${vaultAddress}/txs`)) as MempoolAddressTx[];

  let registered = 0;
  for (const { txid } of txs) {
    if (store.hasRecord(txid)) continue;
    try {
      const rawTxHex = (await mempoolGet(`/tx/${txid}/hex`)).trim();
      const tx = stripWitness(rawTxHex);
      const { recipient, amountSats } = parseDepositTx(tx);
      store.createRecord({ txid, checkpointHeight, recipient, amountSats: amountSats.toString() });
      registered += 1;
      logger.info(
        `[btc-deposit-watcher] self-registered previously-unknown deposit ${txid} (recipient ${recipient}, ${amountSats} sats) — the depositor's own POST /submit call likely never completed`
      );
    } catch (err) {
      // Not every tx paying the vault address is a template-matching
      // deposit (e.g. change from a custodian consolidation) — skip
      // quietly rather than logging noise for each one, every poll.
      logger.debug(`[btc-deposit-watcher] ${txid}: not a template-matching deposit, skipping (${err instanceof Error ? err.message : err})`);
    }
  }
  return { scanned: txs.length, registered };
}

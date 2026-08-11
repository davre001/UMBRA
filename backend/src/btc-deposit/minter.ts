import { keccak256, toBytes } from "viem";
import { SHIELDED_VAULT_ABI } from "../shared/vaultAbi";
import { CONTRACTS, assertTxSuccess, getWalletClient, publicClient } from "../shared/chain";
import { logger } from "../shared/logger";
import * as store from "./store";
import type { BtcDepositRecord } from "./types";

/**
 * Auto-mints real, public WrappedBTC for every proven-but-not-yet-minted
 * deposit — the thing that replaces the old private-note design's manual
 * "claim" step (a frontend button submitting depositExternal itself). Once
 * btc-deposit.routes.ts's POST /:id/proof marks a record `proven`, this is
 * the only thing that ever calls `depositExternal` for it — the depositor
 * never signs or clicks anything on the EVM side.
 *
 * Mirrors btc-withdrawal/watcher.ts's poll-and-retry shape, not a
 * fire-once call from inside the /proof route handler, so a transient RPC
 * failure or a mid-restart crash doesn't strand a proven deposit forever —
 * see index.ts's own poll loop wiring.
 */

// Opaque namespace tag for depositExternal's sourceChainId — must match
// contract/scripts/redeploy-vault-wrapped-btc.ts's own derivation exactly
// (keccak256("BTC_SIGNET")), which is what's actually registered in
// checkpoints[] and externalDepositToken[] on-chain.
const BTC_SIGNET_SOURCE_CHAIN_ID = keccak256(toBytes("BTC_SIGNET"));

/**
 * Attempts to mint one proven record. Before submitting, checks
 * `isSpentNullifier` on-chain directly — the in-memory store (see store.ts's
 * own doc) can't survive a restart, so a record that was actually minted
 * just before a crash would otherwise get resubmitted and revert. Treating
 * an already-spent nullifier as a (recovered) success closes that gap
 * without needing real persistence.
 */
export async function attemptMint(record: BtcDepositRecord): Promise<boolean> {
  if (record.status !== "proven" || !record.proof || !record.publicInputs) return false;
  const [checkpointRoot, , , nullifier] = record.publicInputs;

  const alreadySpent = await publicClient.readContract({
    address: CONTRACTS.ShieldedVault as `0x${string}`,
    abi: SHIELDED_VAULT_ABI,
    functionName: "isSpentNullifier",
    args: [BigInt(nullifier)],
  });
  if (alreadySpent) {
    logger.warn(`[btc-deposit-minter] ${record.txid}: nullifier already spent on-chain — treating as already minted (recovered after a restart?)`);
    store.markMinted(record.id, undefined);
    return false;
  }

  try {
    const wallet = getWalletClient();
    logger.info(`[btc-deposit-minter] minting ${record.amountSats} sats WrappedBTC to ${record.recipient} (${record.txid})`);
    const txHash = await wallet.writeContract({
      address: CONTRACTS.ShieldedVault as `0x${string}`,
      abi: SHIELDED_VAULT_ABI,
      functionName: "depositExternal",
      args: [
        CONTRACTS.BtcDepositHonkVerifier as `0x${string}`,
        record.proof,
        {
          sourceChainId: BTC_SIGNET_SOURCE_CHAIN_ID,
          checkpointRoot: checkpointRoot as `0x${string}`,
          recipient: record.recipient,
          amount: BigInt(record.amountSats),
          nullifier: nullifier as `0x${string}`,
        },
      ],
      chain: wallet.chain,
      account: wallet.account!,
    });
    logger.info(`[btc-deposit-minter] ${record.txid}: mint tx sent: ${txHash} — waiting for confirmation`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    assertTxSuccess(receipt);
    store.markMinted(record.id, txHash);
    logger.info(`[btc-deposit-minter] ${record.txid}: minted, confirmed ${txHash}`);
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error(`[btc-deposit-minter] ${record.txid}: mint failed, will retry next poll: ${reason}`);
    return false;
  }
}

/** One pass over every proven-but-not-minted record — see store.listProven(). */
export async function pollOnce(): Promise<{ attempted: number; minted: number }> {
  const pending = store.listProven();
  let minted = 0;
  for (const record of pending) {
    if (await attemptMint(record)) minted += 1;
  }
  return { attempted: pending.length, minted };
}

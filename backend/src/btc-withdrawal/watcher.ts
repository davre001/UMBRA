import { publicClient, CONTRACTS, DEPLOY_BLOCK } from "../shared/chain";
import { SHIELDED_VAULT_ABI } from "../shared/vaultAbi";
import { logger } from "../shared/logger";
import { buildAndSignWithdrawal, InsufficientFundsError } from "./bitcoin-tx";
import { broadcastTx } from "./mempool";
import * as store from "./store";
import type { BtcWithdrawalRequest } from "./types";

// Must match contract/circuits/noir/btc_deposit/src/bitcoin.nr's
// BTC_ASSET_ID exactly — only withdrawals for this specific assetId are
// BTC's to fulfill; any other future external-source asset (e.g. ETH)
// would need its own watcher filtering its own assetId, not this one.
const BTC_ASSET_ID = BigInt(999);

// drpc.org's free tier caps eth_getLogs at 10,000 blocks per call — same
// constraint and same chunk size shared/scan.ts's own getLogsChunked
// already works around, reimplemented locally rather than importing a
// private helper from that file.
const MAX_LOG_RANGE = BigInt(9999);

interface ExternalWithdrawalRequestedLog {
  args: { assetId: bigint; nullifierHash: bigint; destination: `0x${string}`; amount: bigint };
  blockNumber: bigint;
}

async function fetchNewEvents(vaultAddress: `0x${string}`, fromBlock: bigint, toBlock: bigint): Promise<ExternalWithdrawalRequestedLog[]> {
  const abiEvent = SHIELDED_VAULT_ABI.find((e) => e.type === "event" && e.name === "ExternalWithdrawalRequested");
  const logs: ExternalWithdrawalRequestedLog[] = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_RANGE + BigInt(1)) {
    const end = start + MAX_LOG_RANGE < toBlock ? start + MAX_LOG_RANGE : toBlock;
    const chunk = await publicClient.getLogs({ address: vaultAddress, event: abiEvent as never, fromBlock: start, toBlock: end });
    logs.push(...(chunk as unknown as ExternalWithdrawalRequestedLog[]));
  }
  return logs;
}

/** hash160 hex from the low 160 bits of the event's `destination` (an `address`-typed value reinterpreted — see ShieldedVault.sol's NatSpec). */
function destinationToHash160(destination: `0x${string}`): string {
  return destination.slice(2).toLowerCase().padStart(40, "0");
}

async function fulfillOne(log: ExternalWithdrawalRequestedLog): Promise<void> {
  const nullifierHash = log.args.nullifierHash.toString();
  const existing = store.getRecord(nullifierHash);
  if (existing?.status === "broadcast") {
    logger.debug(`[btc-withdrawal] ${nullifierHash}: already broadcast (${existing.payoutTxid}), skipping`);
    return;
  }

  const destinationHash160 = destinationToHash160(log.args.destination);
  const amountSats = log.args.amount;
  const record: BtcWithdrawalRequest = existing ?? {
    nullifierHash,
    assetId: log.args.assetId.toString(),
    destinationHash160,
    amountSats: amountSats.toString(),
    status: "pending",
    requestedAtBlock: log.blockNumber.toString(),
    observedAt: Date.now(),
  };
  await store.upsertPending(record);

  try {
    logger.info(`[btc-withdrawal] fulfilling ${nullifierHash}: ${amountSats} sats -> ${destinationHash160}`);
    const { rawHex, txid, feeSats } = await buildAndSignWithdrawal(destinationHash160, amountSats);
    const broadcastTxid = await broadcastTx(rawHex);
    if (broadcastTxid !== txid) {
      logger.warn(`[btc-withdrawal] ${nullifierHash}: locally-computed txid ${txid} != broadcast-returned ${broadcastTxid}, trusting the broadcast response`);
    }
    logger.info(`[btc-withdrawal] ${nullifierHash}: broadcast ${broadcastTxid} (fee ${feeSats} sats)`);
    await store.markBroadcast(nullifierHash, broadcastTxid);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (err instanceof InsufficientFundsError) {
      // Not a permanent failure — the custodian may be topped up later.
      // Left `pending` so the next poll retries automatically; logged as
      // an error because it needs a human to notice regardless.
      logger.error(`[btc-withdrawal] ${nullifierHash}: insufficient custodian funds — will retry next poll: ${reason}`);
      return;
    }
    await store.markFailed(nullifierHash, reason);
  }
}

/** One pass: scan for new ExternalWithdrawalRequested events (assetId == BTC_ASSET_ID) since the last processed block, fulfill each. A single failure doesn't stop the rest — see fulfillOne's own error handling. */
export async function pollOnce(): Promise<{ scanned: number; fulfilled: number }> {
  const vaultAddress = CONTRACTS.ShieldedVault as `0x${string}`;
  const fromBlock = (store.getLastProcessedBlock() ?? DEPLOY_BLOCK - BigInt(1)) + BigInt(1);
  const toBlock = await publicClient.getBlockNumber();
  if (fromBlock > toBlock) return { scanned: 0, fulfilled: 0 };

  const events = await fetchNewEvents(vaultAddress, fromBlock, toBlock);
  const btcEvents = events.filter((e) => e.args.assetId === BTC_ASSET_ID);
  logger.debug(`[btc-withdrawal] scanned blocks ${fromBlock}-${toBlock}: ${events.length} withdrawal event(s), ${btcEvents.length} for BTC`);

  let fulfilled = 0;
  for (const log of btcEvents) {
    const before = store.getRecord(log.args.nullifierHash.toString())?.status;
    await fulfillOne(log);
    const after = store.getRecord(log.args.nullifierHash.toString())?.status;
    if (before !== "broadcast" && after === "broadcast") fulfilled += 1;
  }

  await store.setLastProcessedBlock(toBlock);
  return { scanned: btcEvents.length, fulfilled };
}

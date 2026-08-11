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

/**
 * Attempts to fulfill a single stored record (already upserted as
 * `pending` by the caller). Returns true iff this call is the one that
 * broadcast it. On InsufficientFundsError, leaves the record `pending` —
 * the caller MUST be able to find it again on a later poll independent of
 * `lastProcessedBlock`/block-range log scanning, since that range only
 * ever moves forward and would otherwise never re-surface this event (see
 * `pollOnce`'s own retry-via-`listPending` pass, which is what actually
 * makes this comment true — a prior version of this file left the record
 * `pending` with an identical claim but nothing ever revisited it).
 */
export async function attemptFulfillment(record: BtcWithdrawalRequest): Promise<boolean> {
  if (record.status === "broadcast") return false;
  try {
    logger.info(`[btc-withdrawal] fulfilling ${record.nullifierHash}: ${record.amountSats} sats -> ${record.destinationHash160}`);
    const { rawHex, txid, feeSats } = await buildAndSignWithdrawal(record.destinationHash160, BigInt(record.amountSats));
    const broadcastTxid = await broadcastTx(rawHex);
    if (broadcastTxid !== txid) {
      logger.warn(`[btc-withdrawal] ${record.nullifierHash}: locally-computed txid ${txid} != broadcast-returned ${broadcastTxid}, trusting the broadcast response`);
    }
    logger.info(`[btc-withdrawal] ${record.nullifierHash}: broadcast ${broadcastTxid} (fee ${feeSats} sats)`);
    await store.markBroadcast(record.nullifierHash, broadcastTxid);
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (err instanceof InsufficientFundsError) {
      logger.error(`[btc-withdrawal] ${record.nullifierHash}: insufficient custodian funds — will retry next poll: ${reason}`);
      return false;
    }
    await store.markFailed(record.nullifierHash, reason);
    return false;
  }
}

async function fulfillOne(log: ExternalWithdrawalRequestedLog): Promise<boolean> {
  const nullifierHash = log.args.nullifierHash.toString();
  const existing = store.getRecord(nullifierHash);
  if (existing?.status === "broadcast") {
    logger.debug(`[btc-withdrawal] ${nullifierHash}: already broadcast (${existing.payoutTxid}), skipping`);
    return false;
  }

  const record: BtcWithdrawalRequest = existing ?? {
    nullifierHash,
    assetId: log.args.assetId.toString(),
    destinationHash160: destinationToHash160(log.args.destination),
    amountSats: log.args.amount.toString(),
    status: "pending",
    requestedAtBlock: log.blockNumber.toString(),
    observedAt: Date.now(),
  };
  await store.upsertPending(record);
  return attemptFulfillment(record);
}

/**
 * One pass: (1) retries every already-stored `pending` record directly via
 * `store.listPending()` — this is what actually closes the
 * InsufficientFundsError retry gap, independent of block-range scanning,
 * which by construction only ever looks forward and would otherwise never
 * revisit a block once `lastProcessedBlock` moves past it; then (2) scans
 * for brand-new ExternalWithdrawalRequested events (assetId == BTC_ASSET_ID)
 * since the last processed block and fulfills each. A single failure
 * doesn't stop the rest — see attemptFulfillment's own error handling.
 */
export async function pollOnce(): Promise<{ scanned: number; fulfilled: number }> {
  let fulfilled = 0;

  for (const record of store.listPending()) {
    if (await attemptFulfillment(record)) fulfilled += 1;
  }

  const vaultAddress = CONTRACTS.ShieldedVault as `0x${string}`;
  const fromBlock = (store.getLastProcessedBlock() ?? DEPLOY_BLOCK - BigInt(1)) + BigInt(1);
  const toBlock = await publicClient.getBlockNumber();
  if (fromBlock > toBlock) return { scanned: 0, fulfilled };

  const events = await fetchNewEvents(vaultAddress, fromBlock, toBlock);
  const btcEvents = events.filter((e) => e.args.assetId === BTC_ASSET_ID);
  logger.debug(`[btc-withdrawal] scanned blocks ${fromBlock}-${toBlock}: ${events.length} withdrawal event(s), ${btcEvents.length} for BTC`);

  for (const log of btcEvents) {
    if (await fulfillOne(log)) fulfilled += 1;
  }

  await store.setLastProcessedBlock(toBlock);
  return { scanned: btcEvents.length, fulfilled };
}

import { SHIELDED_VAULT_ABI } from "./vaultAbi";
import { publicClient, DEPLOY_BLOCK } from "./chain";
import { ZERO_VALUE } from "./merkleTree";
import { logger } from "./logger";

const LEAF_EVENTS = ["Shielded", "Paid", "OrderPlaced", "OrderCancelled"] as const;

// drpc.org's free tier caps eth_getLogs at a 10,000-block range per call — a
// single fromBlock=DEPLOY_BLOCK..latest call (this scan's original shape)
// now exceeds that as the chain has grown since deployment. 9999 keeps every
// window comfortably under the cap.
const MAX_LOG_RANGE = BigInt(9999);

/** getLogs in <=MAX_LOG_RANGE-block windows, concatenated — see MAX_LOG_RANGE for why a single unbounded call no longer works. */
async function getLogsChunked(address: `0x${string}`, event: unknown, fromBlock: bigint, toBlock: bigint) {
  const logs: unknown[] = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_RANGE + BigInt(1)) {
    const end = start + MAX_LOG_RANGE < toBlock ? start + MAX_LOG_RANGE : toBlock;
    logs.push(...(await publicClient.getLogs({ address, event: event as never, fromBlock: start, toBlock: end })));
  }
  return logs;
}

interface LeafEvent {
  commitment: bigint;
  leafIndex: number;
  blockNumber: bigint;
  logIndex: number;
}

/** See frontend/src/lib/noteWallet/scan.ts for the full design note on why this retries once. */
export class LeafOrderingMismatchError extends Error {}

async function fetchAllLeavesOnce(vaultAddress: `0x${string}`, fromBlock: bigint) {
  // Resolved once, rather than passing "latest" to every getLogs call below
  // — beyond avoiding a second/third resolution racing ahead of the first
  // (a source of the reorg/indexing-lag mismatch fetchAllLeaves already
  // retries on), a fixed toBlock is also what the chunking loop needs to
  // know where to stop.
  const toBlock = await publicClient.getBlockNumber();
  logger.debug(`[scan] fetching leaves from block ${fromBlock} to ${toBlock} (${toBlock - fromBlock} blocks)`);

  const perEventLogs = await Promise.all(
    LEAF_EVENTS.map((eventName) => {
      const abiEvent = SHIELDED_VAULT_ABI.find((e) => e.type === "event" && e.name === eventName);
      return getLogsChunked(vaultAddress, abiEvent, fromBlock, toBlock);
    })
  );

  const matchedAbiEvent = SHIELDED_VAULT_ABI.find((e) => e.type === "event" && e.name === "OrdersMatched");
  const matchedLogs = await getLogsChunked(vaultAddress, matchedAbiEvent, fromBlock, toBlock);

  const events: LeafEvent[] = [];
  for (const logs of perEventLogs) {
    for (const log of logs as unknown as {
      args: { commitment?: bigint; orderCommitment?: bigint; refundCommitment?: bigint; outCommitment?: bigint; leafIndex: number };
      blockNumber: bigint;
      logIndex: number;
    }[]) {
      const commitment = log.args.commitment ?? log.args.orderCommitment ?? log.args.refundCommitment ?? log.args.outCommitment;
      if (commitment === undefined) continue;
      events.push({ commitment, leafIndex: log.args.leafIndex, blockNumber: log.blockNumber, logIndex: log.logIndex });
    }
  }
  // A match inserts 2-4 leaves: the two matched-proceeds notes always, plus
  // a residual order for whichever side wasn't fully filled (partial fills
  // — see circuits/DESIGN.md). ZERO_VALUE (the domain-separated empty-leaf
  // constant) signals "no residual"; the contract itself skips inserting it,
  // so this reconstruction must skip it too, in the exact same order
  // ShieldedVault.matchOrders inserts them (out A, out B, residual A,
  // residual B).
  for (const log of matchedLogs as unknown as {
    args: { outCommitmentA: bigint; outCommitmentB: bigint; residualCommitmentA: bigint; residualCommitmentB: bigint };
    blockNumber: bigint;
    logIndex: number;
  }[]) {
    const leaves = [log.args.outCommitmentA, log.args.outCommitmentB, log.args.residualCommitmentA, log.args.residualCommitmentB];
    let offset = 0;
    for (const commitment of leaves) {
      if (commitment === ZERO_VALUE) continue;
      events.push({ commitment, leafIndex: -1, blockNumber: log.blockNumber, logIndex: log.logIndex + offset * 0.1 });
      offset += 1;
    }
  }

  events.sort((a, b) => (a.blockNumber !== b.blockNumber ? Number(a.blockNumber - b.blockNumber) : a.logIndex - b.logIndex));

  const leaves: bigint[] = [];
  for (const event of events) {
    if (event.leafIndex !== -1 && event.leafIndex !== leaves.length) {
      throw new LeafOrderingMismatchError(
        `Leaf ordering mismatch: event claims index ${event.leafIndex} but reconstructed position is ${leaves.length}`
      );
    }
    leaves.push(event.commitment);
  }

  return leaves;
}

/** Every leaf ever inserted into the tree, in on-chain order — see frontend/src/lib/noteWallet/scan.ts for the full design note (same retry-once-on-reorg behavior). */
export async function fetchAllLeaves(vaultAddress: `0x${string}`, fromBlock: bigint = DEPLOY_BLOCK) {
  try {
    return await fetchAllLeavesOnce(vaultAddress, fromBlock);
  } catch (err) {
    if (!(err instanceof LeafOrderingMismatchError)) throw err;
    try {
      return await fetchAllLeavesOnce(vaultAddress, fromBlock);
    } catch (retryErr) {
      if (retryErr instanceof LeafOrderingMismatchError) {
        throw new LeafOrderingMismatchError(`${retryErr.message} (persisted after retry — likely a real bug, not a transient reorg/indexing-lag artifact)`);
      }
      throw retryErr;
    }
  }
}

export async function isNullifierSpentOnChain(vaultAddress: `0x${string}`, nullifierHashValue: bigint): Promise<boolean> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: SHIELDED_VAULT_ABI,
    functionName: "isSpentNullifier",
    args: [nullifierHashValue],
  });
}

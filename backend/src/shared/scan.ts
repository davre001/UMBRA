import { SHIELDED_VAULT_ABI } from "./vaultAbi";
import { publicClient, DEPLOY_BLOCK } from "./chain";
import { ZERO_VALUE } from "./merkleTree";

const LEAF_EVENTS = ["Shielded", "Paid", "OrderPlaced", "OrderCancelled"] as const;

interface LeafEvent {
  commitment: bigint;
  leafIndex: number;
  blockNumber: bigint;
  logIndex: number;
}

/** See frontend/src/lib/noteWallet/scan.ts for the full design note on why this retries once. */
export class LeafOrderingMismatchError extends Error {}

async function fetchAllLeavesOnce(vaultAddress: `0x${string}`, fromBlock: bigint) {
  const perEventLogs = await Promise.all(
    LEAF_EVENTS.map((eventName) => {
      const abiEvent = SHIELDED_VAULT_ABI.find((e) => e.type === "event" && e.name === eventName);
      return publicClient.getLogs({
        address: vaultAddress,
        event: abiEvent as never,
        fromBlock,
        toBlock: "latest",
      });
    })
  );

  const matchedAbiEvent = SHIELDED_VAULT_ABI.find((e) => e.type === "event" && e.name === "OrdersMatched");
  const matchedLogs = await publicClient.getLogs({
    address: vaultAddress,
    event: matchedAbiEvent as never,
    fromBlock,
    toBlock: "latest",
  });

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

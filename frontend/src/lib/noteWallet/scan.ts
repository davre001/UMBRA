import { decodeFunctionData, type PublicClient } from "viem";
import { SHIELDED_VAULT_ABI } from "./vaultAbi";
import { ZERO_VALUE } from "./merkleTree";
import { getLogsChunked } from "./getLogsChunked";

// Only these methods are used — narrowing to them (rather than the full
// PublicClient) sidesteps a real but irrelevant type mismatch: wagmi's
// config includes op-stack chains whose Block/transaction shape doesn't
// structurally match viem's default PublicClient generic, which otherwise
// blocks passing wagmi's usePublicClient() result in directly. getLogs/
// readContract/getBlockNumber's own signatures don't involve that Block
// type at all. `getTransaction` is narrowed to just the `input` field
// deposit recovery needs, for the same reason — not viem's full Transaction
// return type.
type ScanClient = Pick<PublicClient, "getLogs" | "readContract" | "getBlockNumber"> & {
  getTransaction: (args: { hash: `0x${string}` }) => Promise<{ input: `0x${string}` }>;
};

const LEAF_EVENTS = ["Shielded", "Paid", "OrderPlaced", "OrderCancelled"] as const;

interface LeafEvent {
  commitment: bigint;
  leafIndex: number;
  blockNumber: bigint;
  logIndex: number;
}

/**
 * Thrown when the reconstructed leaf order disagrees with the leafIndex a
 * contract event actually emitted. Distinguished from other errors
 * specifically so `fetchAllLeaves` can retry on it — the five separate
 * getLogs calls (one per event type) aren't atomic, so a chain reorg or an
 * RPC node that hasn't finished indexing between them can produce a
 * genuinely inconsistent snapshot with no logic bug involved. A second,
 * fresh fetch resolves that on its own; if it doesn't, this is very unlikely
 * to be transient and should be treated as fatal.
 */
export class LeafOrderingMismatchError extends Error {}

/** Does the actual fetch-and-reconstruct — see `fetchAllLeaves` for the retry wrapper around this. */
async function fetchAllLeavesOnce(client: ScanClient, vaultAddress: `0x${string}`, fromBlock: bigint) {
  // Resolved once, rather than passing "latest" to every getLogs call below
  // — beyond avoiding a second/third resolution racing ahead of the first
  // (a source of the reorg/indexing-lag mismatch fetchAllLeaves already
  // retries on), a fixed toBlock is also what the chunking loop needs to
  // know where to stop.
  const toBlock = await client.getBlockNumber();

  const perEventLogs = await Promise.all(
    LEAF_EVENTS.map((eventName) => {
      const abiEvent = SHIELDED_VAULT_ABI.find((e) => e.type === "event" && e.name === eventName);
      return getLogsChunked(client, vaultAddress, abiEvent, fromBlock, toBlock);
    })
  );

  // OrdersMatched inserts two leaves in one event — handle separately since
  // its arg names differ (outCommitmentA/outCommitmentB, no single leafIndex).
  const matchedAbiEvent = SHIELDED_VAULT_ABI.find((e) => e.type === "event" && e.name === "OrdersMatched");
  const matchedLogs = await getLogsChunked(client, vaultAddress, matchedAbiEvent, fromBlock, toBlock);

  const events: LeafEvent[] = [];
  for (const logs of perEventLogs) {
    for (const log of logs as unknown as { args: { commitment?: bigint; orderCommitment?: bigint; refundCommitment?: bigint; outCommitment?: bigint; leafIndex: number }; blockNumber: bigint; logIndex: number }[]) {
      const commitment = log.args.commitment ?? log.args.orderCommitment ?? log.args.refundCommitment ?? log.args.outCommitment;
      if (commitment === undefined) continue;
      events.push({ commitment, leafIndex: log.args.leafIndex, blockNumber: log.blockNumber, logIndex: log.logIndex });
    }
  }
  // OrdersMatched doesn't emit leafIndex directly — the leaves it inserts
  // are always the ones immediately after whatever nextLeafIndex was at the
  // time. Cheapest correct approach: sort everything else first, then slot
  // matched leaves in by block/log order and infer indices from position.
  //
  // A match inserts 2-4 leaves: the two matched-proceeds notes always, plus
  // a residual order for whichever side wasn't fully filled (partial fills
  // — see circuits/DESIGN.md). ZERO_VALUE (the domain-separated empty-leaf
  // constant) signals "no residual"; the contract itself skips inserting
  // it, so this reconstruction must skip it too, in the exact same order
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

  // Fill in the -1 placeholders (OrdersMatched leaves) by position, then
  // sanity-check every other event's on-chain leafIndex agrees with its
  // position in this reconstructed order — if it doesn't, something is
  // inconsistent (see LeafOrderingMismatchError for why that isn't
  // necessarily a logic bug) and callers should not trust the result.
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

/**
 * Every leaf ever inserted into the tree, in on-chain order. Needed to build
 * a local MerkleTree instance for proof generation — this legitimately does
 * need every leaf (not just "mine"), since a Merkle proof's siblings can be
 * anyone's commitments.
 *
 * Not a note-recovery mechanism: knowing every commitment on-chain doesn't
 * tell you which ones are yours unless you already know their amount/
 * assetId/blinding (the spending key alone is re-derivable from a wallet
 * signature, but blinding/amount/assetId are chosen at creation time —
 * there's no way to "guess" them by scanning; a note paid to you arrives via
 * announcer.ts's announcement, not this scan). True cross-device recovery of
 * self-created notes needs an encrypted export/import of the local note
 * store (see store.ts), not scanning.
 *
 * Retries once on LeafOrderingMismatchError (a fresh fetch resolves a
 * reorg/indexing-lag artifact on its own) before surfacing it as fatal.
 * Any other error (network failure, etc.) propagates immediately —
 * retrying is this function's job only for the specific inconsistency it
 * knows how to self-correct, not general RPC flakiness.
 */
export async function fetchAllLeaves(client: ScanClient, vaultAddress: `0x${string}`, fromBlock: bigint = BigInt(0)) {
  try {
    return await fetchAllLeavesOnce(client, vaultAddress, fromBlock);
  } catch (err) {
    if (!(err instanceof LeafOrderingMismatchError)) throw err;
    try {
      return await fetchAllLeavesOnce(client, vaultAddress, fromBlock);
    } catch (retryErr) {
      if (retryErr instanceof LeafOrderingMismatchError) {
        throw new LeafOrderingMismatchError(
          `${retryErr.message} (persisted after retry — likely a real bug, not a transient reorg/indexing-lag artifact)`
        );
      }
      throw retryErr;
    }
  }
}

/** Marks a locally-known note's `spent` flag current with on-chain state — covers the note having been spent from a different session/device. */
export async function isNullifierSpentOnChain(
  client: ScanClient,
  vaultAddress: `0x${string}`,
  nullifierHash: bigint
): Promise<boolean> {
  return client.readContract({
    address: vaultAddress,
    abi: SHIELDED_VAULT_ABI,
    functionName: "isSpentNullifier",
    args: [nullifierHash],
  }) as Promise<boolean>;
}

export interface ShieldedDeposit {
  assetId: bigint;
  amount: bigint;
  commitment: bigint;
  leafIndex: number;
}

/**
 * Every `Shielded` deposit ever made into this vault, with its real amount —
 * the `Shielded` event itself only carries `assetId`/`commitment`/`leafIndex`
 * (see ShieldedVault.sol), not `amount`, so each event's own transaction
 * calldata is decoded to recover it. `shield()` isn't proof-gated at all
 * (deposits are public by design — see circuits/DESIGN.md), so this is
 * exactly as public as the event itself, not a new disclosure.
 *
 * Used only by deposit-note recovery (deriveDepositBlinding's `salt` search)
 * — real RPC cost (one extra call per historical deposit across the whole
 * vault, not just this wallet's own), so callers should treat this as an
 * explicit, occasional action, not something run on every page load.
 */
export async function scanShieldedDeposits(
  client: ScanClient,
  vaultAddress: `0x${string}`,
  fromBlock: bigint = BigInt(0)
): Promise<ShieldedDeposit[]> {
  const toBlock = await client.getBlockNumber();
  const shieldedEvent = SHIELDED_VAULT_ABI.find((e) => e.type === "event" && e.name === "Shielded");
  const shieldFn = SHIELDED_VAULT_ABI.find((e) => e.type === "function" && e.name === "shield");
  const logs = (await getLogsChunked(client, vaultAddress, shieldedEvent, fromBlock, toBlock)) as unknown as {
    args: { assetId: bigint; commitment: bigint; leafIndex: number };
    transactionHash: `0x${string}`;
  }[];

  return Promise.all(
    logs.map(async (log) => {
      const tx = await client.getTransaction({ hash: log.transactionHash });
      const decoded = decodeFunctionData({ abi: [shieldFn], data: tx.input }) as unknown as { args: readonly [bigint, bigint, bigint] };
      const [, amount] = decoded.args;
      return { assetId: log.args.assetId, amount, commitment: log.args.commitment, leafIndex: log.args.leafIndex };
    })
  );
}

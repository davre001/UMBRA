import type { PublicClient } from "viem";

type GetLogsClient = Pick<PublicClient, "getLogs">;

// drpc.org's free tier caps eth_getLogs at a 10,000-block range per call — a
// single fromBlock=deployBlock..latest call exceeds that as the chain grows
// since deployment. 9999 keeps every window comfortably under the cap.
export const MAX_LOG_RANGE = BigInt(9999);

/**
 * getLogs in <=MAX_LOG_RANGE-block windows, concatenated — see MAX_LOG_RANGE
 * for why a single unbounded call no longer works. Shared by every full-
 * history scan (deposit/leaf scanning in scan.ts, incoming-announcement
 * scanning in announcer.ts) so the block-range cap only needs handling once.
 */
export async function getLogsChunked(
  client: GetLogsClient,
  address: `0x${string}`,
  event: unknown,
  fromBlock: bigint,
  toBlock: bigint,
  args?: unknown
) {
  const logs: unknown[] = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_RANGE + BigInt(1)) {
    const end = start + MAX_LOG_RANGE < toBlock ? start + MAX_LOG_RANGE : toBlock;
    logs.push(
      ...(await client.getLogs({ address, event: event as never, args: args as never, fromBlock: start, toBlock: end }))
    );
  }
  return logs;
}

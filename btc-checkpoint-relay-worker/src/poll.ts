import { currentSignetTipHeight, fetchExtensionHeaders, K } from "./headers";
import { proveCheckpointExtension } from "./prove";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

function requireSecret(): string {
  const secret = process.env.BTC_DEPOSIT_INTERNAL_SECRET;
  if (!secret) throw new Error("BTC_DEPOSIT_INTERNAL_SECRET not set — see .env.example");
  return secret;
}

async function fetchTrackedHeight(): Promise<number | null> {
  const res = await fetch(`${BACKEND_URL}/api/btc-deposit/checkpoint`);
  if (!res.ok) throw new Error(`GET /checkpoint failed: ${res.status}`);
  const body = (await res.json()) as { checkpointHeight: number | null };
  return body.checkpointHeight;
}

async function submitExtension(
  proof: `0x${string}`,
  newCheckpointCommitment: `0x${string}`,
  newHeight: number
): Promise<`0x${string}`> {
  const res = await fetch(`${BACKEND_URL}/api/btc-deposit/checkpoint/extend`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-btc-deposit-secret": requireSecret() },
    body: JSON.stringify({ proof, newCheckpointCommitment, newHeight }),
  });
  if (!res.ok) throw new Error(`POST /checkpoint/extend failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { txHash: `0x${string}` };
  return body.txHash;
}

/**
 * One pass: reads the backend's currently-tracked checkpoint height, then
 * proves+submits as many K-header hops as the real signet chain currently
 * supports — not just one — so a single invocation (including a scheduled
 * Lambda tick) fully catches up after downtime instead of trickling forward
 * one hop per poll interval. A no-op (not an error) when the checkpoint
 * hasn't been initialized yet (contract/scripts/initialize-btc-checkpoint.ts
 * hasn't run) or when the real chain hasn't produced K more blocks since
 * the last extension — signet averages ~10min blocks, so most ticks at the
 * default POLL_INTERVAL_MS will find nothing to do, and that's expected,
 * not a failure.
 */
export async function pollOnce(): Promise<{ extensions: number; newHeight?: number; lastTxHash?: `0x${string}` }> {
  const trackedHeight = await fetchTrackedHeight();
  if (trackedHeight === null) {
    console.log("[btc-checkpoint-relay-worker] no checkpoint tracked yet — waiting for initialize-btc-checkpoint.ts's genesis bootstrap");
    return { extensions: 0 };
  }

  const tip = await currentSignetTipHeight();
  let extensions = 0;
  let lastTxHash: `0x${string}` | undefined;
  let checkpointHeight: number = trackedHeight;

  while (checkpointHeight + K <= tip) {
    const targetHeight: number = checkpointHeight + K;
    console.log(`[btc-checkpoint-relay-worker] extending checkpoint ${checkpointHeight} -> ${targetHeight}...`);
    const { checkpointHashHex, headersHex } = await fetchExtensionHeaders(checkpointHeight);
    const { proof, newCommitment } = await proveCheckpointExtension({ checkpointHashHex, headersHex });
    lastTxHash = await submitExtension(proof, newCommitment, targetHeight);
    console.log(`[btc-checkpoint-relay-worker] extended to ${targetHeight}: ${lastTxHash}`);
    checkpointHeight = targetHeight;
    extensions += 1;
  }

  if (extensions === 0) {
    console.log(`[btc-checkpoint-relay-worker] checkpoint at ${checkpointHeight}, signet tip at ${tip} — need ${checkpointHeight + K - tip} more block(s) before the next extension`);
  }

  return { extensions, newHeight: extensions > 0 ? checkpointHeight : undefined, lastTxHash };
}

export { BACKEND_URL };

import "dotenv/config";
import { pollOnce } from "./poll";

/**
 * AWS Lambda entrypoint — triggered on a schedule (EventBridge), not by an
 * HTTP request, so the incoming event is ignored. Its own function and
 * schedule, deliberately NOT btc-deposit-worker's or matcher-worker's
 * Lambda — signet averages ~10min blocks, so scripts/deploy-lambda.sh here
 * defaults to a much longer POLL_MINUTES than either of those (no point
 * checking every minute for something that changes roughly every 10).
 * Deliberately does NOT call destroyProver() after each invocation — same
 * reasoning as the other workers' lambda.ts: Lambda reuses "warm" execution
 * environments between invocations, and letting the Barretenberg WASM
 * instance (prove.ts's module-level apiPromise) persist across those avoids
 * re-initializing it on every tick.
 */
export async function handler(): Promise<{ extensions: number }> {
  try {
    const result = await pollOnce();
    return { extensions: result.extensions };
  } catch (err) {
    // Log with full context before re-throwing — a bare rethrow still
    // reaches CloudWatch, but only as whatever message the failing call
    // itself produced, with no [btc-checkpoint-relay-worker] tag to grep
    // for and no explicit "this invocation did nothing" framing. Re-thrown
    // (not swallowed) on purpose: Lambda's own Errors metric/EventBridge
    // retry behavior is the actual alerting mechanism here, and swallowing
    // this would make repeated failures invisible to it.
    console.error("[btc-checkpoint-relay-worker] poll failed:", err);
    throw err;
  }
}

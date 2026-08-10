import "dotenv/config";
import { pollOnce } from "./poll";

/**
 * AWS Lambda entrypoint — triggered on a schedule (EventBridge), not by an
 * HTTP request, so the incoming event is ignored. Its own function and
 * schedule, deliberately NOT matcher-worker's Lambda: that one polls every
 * 5 minutes because match_orders benefits from batching; BTC deposits have
 * no such reason to wait, so scripts/deploy-lambda.sh here defaults to a
 * 1-minute rate (EventBridge's own minimum granularity for a rate()
 * expression). Deliberately does NOT call destroyProver() after each
 * invocation — same reasoning as matcher-worker/src/lambda.ts: Lambda
 * reuses "warm" execution environments between invocations, and letting
 * the Barretenberg WASM instance (prove.ts's module-level apiPromise)
 * persist across those avoids re-initializing it on every tick.
 */
export async function handler(): Promise<{ attempted: number }> {
  return pollOnce();
}

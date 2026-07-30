import "dotenv/config";
import { pollOnce } from "./poll";

/**
 * AWS Lambda entrypoint — triggered on a schedule (EventBridge), not by an
 * HTTP request, so the incoming event is ignored. Deliberately does NOT call
 * destroyProver() after each invocation: Lambda reuses "warm" execution
 * environments between invocations, and letting the Barretenberg WASM
 * instance (prove.ts's module-level apiPromise) persist across those avoids
 * re-initializing it — the expensive part — on every single scheduled tick.
 * It only ever gets torn down when Lambda itself recycles the environment,
 * which this code has no hook into and doesn't need one for.
 */
export async function handler(): Promise<{ attempted: number }> {
  return pollOnce();
}

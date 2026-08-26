import "dotenv/config";
import { pollOnce, BACKEND_URL } from "./poll";
import { destroyProver } from "./prove";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 600_000);

if (!process.env.BTC_DEPOSIT_INTERNAL_SECRET) {
  console.error("BTC_DEPOSIT_INTERNAL_SECRET not set — see .env.example");
  process.exit(1);
}

async function main(): Promise<void> {
  const runOnce = process.argv.includes("--once");
  console.log(`[btc-checkpoint-relay-worker] polling ${BACKEND_URL} every ${POLL_INTERVAL_MS}ms${runOnce ? " (--once)" : ""}`);

  if (runOnce) {
    await pollOnce();
    await destroyProver();
    return;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // A transient failure (signet API down, backend hiccup mid multi-hop
    // catch-up) shouldn't kill a long-running poll process — same "leave
    // it for the next poll, don't hard-fail" philosophy pollOnce's own
    // per-record error handling already follows one level down. Only
    // --once/Lambda mode (see lambda.ts) lets an error propagate, since
    // those have an external caller (a human, or Lambda's own retry/error
    // metric) that should actually see the failure.
    try {
      await pollOnce();
    } catch (err) {
      console.error("[btc-checkpoint-relay-worker] poll failed, will retry next cycle:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error("[btc-checkpoint-relay-worker] fatal:", err);
  process.exitCode = 1;
});

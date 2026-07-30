import "dotenv/config";
import { pollOnce, BACKEND_URL } from "./poll";
import { destroyProver } from "./prove";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);

if (!process.env.MATCHER_INTERNAL_SECRET) {
  console.error("MATCHER_INTERNAL_SECRET not set — see .env.example");
  process.exit(1);
}

async function main(): Promise<void> {
  const runOnce = process.argv.includes("--once");
  console.log(`[matcher-worker] polling ${BACKEND_URL} every ${POLL_INTERVAL_MS}ms${runOnce ? " (--once)" : ""}`);

  if (runOnce) {
    await pollOnce();
    await destroyProver();
    return;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await pollOnce();
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error("[matcher-worker] fatal:", err);
  process.exitCode = 1;
});

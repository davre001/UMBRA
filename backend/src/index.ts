import "dotenv/config";
import { createApp } from "./app";
import { DEFAULT_PORT } from "./shared/constants";
import { logger } from "./shared/logger";
import { hydrateFromStore } from "./dark-engine/matcher";
import { pollOnce as pollBtcWithdrawals } from "./btc-withdrawal/watcher";
import { hydrate as hydrateBtcWithdrawals } from "./btc-withdrawal/store";

const app = createApp();
const port = Number(process.env.PORT) || DEFAULT_PORT;

/**
 * Starts the BTC withdrawal fulfillment loop — genuinely optional, unlike
 * hydrateFromStore: BTC_CUSTODIAN_WIF holds a real signing key, so this
 * only runs on a deployment that's deliberately configured to be the
 * custodian (most environments, including plain local dev, shouldn't have
 * this set at all). Runs after the server starts accepting requests, not
 * before — nothing about serving HTTP depends on this loop, and a real
 * network call (fetching blocks/UTXOs) shouldn't gate readiness the way
 * hydrateFromStore's local/db read does.
 *
 * The one hard ordering requirement: `hydrateBtcWithdrawals()` MUST finish
 * before the first poll tick runs — this is exactly the durable-store
 * fix's whole point (see btc-withdrawal/store.ts's own doc). A tick
 * running against an empty in-memory store on a fresh restart is the
 * double-payout risk this was built to close, so unlike HTTP readiness,
 * this ordering is not optional.
 */
async function startBtcWithdrawalWatcher(): Promise<void> {
  if (!process.env.BTC_CUSTODIAN_WIF) {
    logger.info("[btc-withdrawal] BTC_CUSTODIAN_WIF not set — withdrawal fulfillment loop not started");
    return;
  }
  await hydrateBtcWithdrawals();
  const intervalMs = Number(process.env.BTC_WITHDRAWAL_POLL_INTERVAL_MS ?? 30_000);
  logger.info(`[btc-withdrawal] starting fulfillment loop, polling every ${intervalMs}ms`);
  const tick = () =>
    pollBtcWithdrawals().catch((err) => {
      logger.error(`[btc-withdrawal] poll cycle failed: ${err instanceof Error ? err.message : err}`);
    });
  tick();
  setInterval(tick, intervalMs);
}

// Must finish before the server accepts traffic — a request landing
// mid-hydration would see a partially-empty order book and could rest a
// duplicate of an order still being loaded. See matcher.ts/store.ts for why
// this exists at all (Render's free plan has no persistent disk).
hydrateFromStore()
  .then(() => {
    app.listen(port, () => {
      logger.info(`Umbra backend listening on http://localhost:${port}`);
      startBtcWithdrawalWatcher().catch((err) => {
        logger.error(`[btc-withdrawal] failed to start fulfillment loop: ${err instanceof Error ? err.message : err}`);
      });
    });
  })
  .catch((err) => {
    logger.error(`[dark-engine] failed to hydrate matcher state from store — refusing to start: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });

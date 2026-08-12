import "dotenv/config";
import { createApp } from "./app";
import { DEFAULT_PORT } from "./shared/constants";
import { logger } from "./shared/logger";
import { hydrateFromStore } from "./dark-engine/matcher";
import { pollOnce as pollBtcWithdrawals } from "./btc-withdrawal/watcher";
import { hydrate as hydrateBtcWithdrawals } from "./btc-withdrawal/store";
import { pollOnce as pollBtcDepositMints } from "./btc-deposit/minter";
import { pollOnce as pollBtcDepositWatcher } from "./btc-deposit/depositWatcher";

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
  // setInterval fires on a fixed wall-clock schedule regardless of whether
  // the previous tick's promise has resolved — a cycle running long
  // (header fetches, a real broadcast call) could otherwise overlap with
  // the next one, and since fulfillOne/attemptFulfillment only skip a
  // record already `broadcast` (not `pending`), two overlapping polls
  // could both sign and broadcast a payout for the same nullifierHash.
  // This flag is the guard: a tick that finds one still in flight is
  // simply skipped, not queued — the next interval will pick it up once
  // the running one finishes.
  let running = false;
  const tick = async () => {
    if (running) {
      logger.warn("[btc-withdrawal] previous poll cycle still running — skipping this tick");
      return;
    }
    running = true;
    try {
      await pollBtcWithdrawals();
    } catch (err) {
      logger.error(`[btc-withdrawal] poll cycle failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      running = false;
    }
  };
  tick();
  setInterval(tick, intervalMs);
}

/**
 * Starts the BTC deposit auto-minting loop — replaces the old private-note
 * design's manual "claim" step (see btc-deposit/minter.ts's own doc).
 * Gated on PRIVATE_KEY the same defensive way the withdrawal loop is gated
 * on BTC_CUSTODIAN_WIF, even though every other route in this backend
 * already assumes PRIVATE_KEY is set — a deployment that genuinely lacks
 * it shouldn't crash-loop on this poller instead of just skipping it.
 */
function startBtcDepositMinter(): void {
  if (!process.env.PRIVATE_KEY) {
    logger.info("[btc-deposit-minter] PRIVATE_KEY not set — auto-minting loop not started");
    return;
  }
  const intervalMs = Number(process.env.BTC_DEPOSIT_MINT_POLL_INTERVAL_MS ?? 30_000);
  logger.info(`[btc-deposit-minter] starting auto-mint loop, polling every ${intervalMs}ms`);
  let running = false;
  const tick = async () => {
    if (running) {
      logger.warn("[btc-deposit-minter] previous poll cycle still running — skipping this tick");
      return;
    }
    running = true;
    try {
      await pollBtcDepositMints();
    } catch (err) {
      logger.error(`[btc-deposit-minter] poll cycle failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      running = false;
    }
  };
  tick();
  setInterval(tick, intervalMs);
}

/**
 * Starts the deposit self-registration backstop (see depositWatcher.ts's
 * own doc for the exact gap this closes). Gated on BTC_VAULT_PUBKEY_HASH
 * rather than a signing key — it only ever reads chain data, never signs
 * or spends anything — but still shouldn't run against mempool.ts's zero
 * placeholder default in a deployment that hasn't configured a real vault
 * address yet.
 */
function startBtcDepositWatcher(): void {
  if (!process.env.BTC_VAULT_PUBKEY_HASH) {
    logger.info("[btc-deposit-watcher] BTC_VAULT_PUBKEY_HASH not set — self-registration loop not started");
    return;
  }
  const intervalMs = Number(process.env.BTC_DEPOSIT_WATCH_POLL_INTERVAL_MS ?? 30_000);
  logger.info(`[btc-deposit-watcher] starting self-registration loop, polling every ${intervalMs}ms`);
  let running = false;
  const tick = async () => {
    if (running) {
      logger.warn("[btc-deposit-watcher] previous poll cycle still running — skipping this tick");
      return;
    }
    running = true;
    try {
      const { scanned, registered } = await pollBtcDepositWatcher();
      if (registered > 0) {
        logger.info(`[btc-deposit-watcher] scanned ${scanned} vault tx(es), self-registered ${registered} previously-unknown deposit(s)`);
      }
    } catch (err) {
      logger.error(`[btc-deposit-watcher] poll cycle failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      running = false;
    }
  };
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
      startBtcDepositMinter();
      startBtcDepositWatcher();
    });
  })
  .catch((err) => {
    logger.error(`[dark-engine] failed to hydrate matcher state from store — refusing to start: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });

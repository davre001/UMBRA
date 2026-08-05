import "dotenv/config";
import { createApp } from "./app";
import { DEFAULT_PORT } from "./shared/constants";
import { logger } from "./shared/logger";
import { hydrateFromStore } from "./dark-engine/matcher";

const app = createApp();
const port = Number(process.env.PORT) || DEFAULT_PORT;

// Must finish before the server accepts traffic — a request landing
// mid-hydration would see a partially-empty order book and could rest a
// duplicate of an order still being loaded. See matcher.ts/store.ts for why
// this exists at all (Render's free plan has no persistent disk).
hydrateFromStore()
  .then(() => {
    app.listen(port, () => {
      logger.info(`Umbra backend listening on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    logger.error(`[dark-engine] failed to hydrate matcher state from store — refusing to start: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });

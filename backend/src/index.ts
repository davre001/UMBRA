import "dotenv/config";
import { createApp } from "./app";
import { DEFAULT_PORT } from "./shared/constants";
import { logger } from "./shared/logger";

const app = createApp();
const port = Number(process.env.PORT) || DEFAULT_PORT;

app.listen(port, () => {
  logger.info(`Umbra backend listening on http://localhost:${port}`);
});

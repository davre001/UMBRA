import "dotenv/config";
import { createApp } from "./app";
import { DEFAULT_PORT } from "./shared/constants";

const app = createApp();
const port = Number(process.env.PORT) || DEFAULT_PORT;

app.listen(port, () => {
  console.log(`Umbra backend listening on http://localhost:${port}`);
});

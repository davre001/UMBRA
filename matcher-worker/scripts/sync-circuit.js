// Copies the compiled match_orders circuit from the monorepo's contract/
// package into this package's own ./circuit/ directory — see prove.ts's
// own comment for why this package needs a local, self-contained copy
// rather than reaching across to contract/ at runtime. Re-run this whenever
// contract/circuits/noir/match_orders/src/main.nr changes and gets
// recompiled.
const fs = require("fs");
const path = require("path");

const SOURCE = path.join(__dirname, "../../contract/circuits/noir/match_orders/target/match_orders.json");
const DEST_DIR = path.join(__dirname, "../circuit");
const DEST = path.join(DEST_DIR, "match_orders.json");

if (!fs.existsSync(SOURCE)) {
  console.error(`Compiled circuit not found at ${SOURCE} — run \`nargo compile\` in contract/circuits/noir/match_orders first.`);
  process.exit(1);
}

fs.mkdirSync(DEST_DIR, { recursive: true });
fs.copyFileSync(SOURCE, DEST);
console.log(`Synced ${SOURCE} -> ${DEST}`);

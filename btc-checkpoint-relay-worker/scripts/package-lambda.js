// Stages a Lambda-ready deployment directory (lambda-build/) — compiled
// dist/, the synced circuit JSON, package.json, and a real, fully-vendored
// production node_modules (see vendor-deps.js). Run
// `npm run build && npm run sync-circuit` first. Zipping lambda-build/'s
// contents (not the directory itself) is a separate step — see
// deploy-lambda.sh — since zip tooling differs by platform and this stays
// portable without picking one.
//
// Deliberately NOT `npm ci --omit=dev` (what this used to do): confirmed
// the hard way that it produces a Lambda that fails at runtime with
// "Cannot find module '@noir-lang/acvm_js'" — pnpm resolves
// @noir-lang/noir_js's own dependency on acvm_js through a per-package
// resolution scope inside its content-addressable store, which a plain
// `npm ci` inside lambda-build/ (a directory outside any pnpm workspace)
// can't reconstruct. vendor-deps.js resolves the real transitive closure
// via Node's own require.resolve instead of trusting a fresh install to
// get pnpm's resolution scheme right.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const STAGE = path.join(ROOT, "lambda-build");

function rm(p) {
  fs.rmSync(p, { recursive: true, force: true });
}
function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
}

for (const required of ["dist", "circuit"]) {
  if (!fs.existsSync(path.join(ROOT, required))) {
    console.error(`Missing ${required}/ — run \`npm run build\` and \`npm run sync-circuit\` first.`);
    process.exit(1);
  }
}

console.log("Staging lambda-build/...");
rm(STAGE);
fs.mkdirSync(STAGE, { recursive: true });
copyDir(path.join(ROOT, "dist"), path.join(STAGE, "dist"));
copyDir(path.join(ROOT, "circuit"), path.join(STAGE, "circuit"));
fs.copyFileSync(path.join(ROOT, "package.json"), path.join(STAGE, "package.json"));

console.log("Vendoring real production dependencies into lambda-build/node_modules...");
execFileSync(process.execPath, [path.join(__dirname, "vendor-deps.js")], { stdio: "inherit" });

console.log(`Staged at ${STAGE} — zip its *contents* (not the folder itself) for Lambda upload. See deploy-lambda.sh.`);

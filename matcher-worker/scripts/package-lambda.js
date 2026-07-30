// Stages a Lambda-ready deployment directory (lambda-build/) — compiled
// dist/, the synced circuit JSON, package.json, and a *production-only*
// node_modules. Run `npm run build && npm run sync-circuit` first. Zipping
// lambda-build/'s contents (not the directory itself) is a separate step —
// see README.md — since zip tooling differs by platform and this stays
// portable without picking one.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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
fs.copyFileSync(path.join(ROOT, "package-lock.json"), path.join(STAGE, "package-lock.json"));

console.log("Installing production-only dependencies into lambda-build/...");
// Fixed command, no user input — safe to run through the shell (needed on
// Windows, where execFileSync can't invoke npm's .cmd shim directly).
execSync("npm ci --omit=dev", { cwd: STAGE, stdio: "inherit" });

console.log(`Staged at ${STAGE} — zip its *contents* (not the folder itself) for Lambda upload. See README.md.`);

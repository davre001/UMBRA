// Vendors a complete, fully-dereferenced production node_modules for the
// Lambda zip — worked around here because pnpm resolves each package's own
// transitive dependencies via a PER-PACKAGE node_modules folder inside its
// content-addressable store (e.g. @noir-lang/noir_js's own dependency on
// @noir-lang/acvm_js lives as a sibling inside noir_js's own resolution
// scope, not inside noir_js's real directory tree, and not as a top-level
// entry in this worker's own node_modules either) — so a naive "copy
// node_modules, dereferencing symlinks" (tried both `cp -rL` and Node's
// fs.cpSync({dereference:true}) first, both failed the same way) never
// picks it up: there's nothing wrong with the dereferencing, the package
// just isn't reachable by walking this worker's own node_modules tree at
// all. This resolves the REAL transitive closure by reading each package's
// own package.json `dependencies` and repeating `require.resolve()` from
// that package's own directory (so pnpm's real resolution scope applies
// correctly at every level), not by guessing from this worker's own
// package.json alone.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEST = path.join(ROOT, "lambda-build/node_modules");

function pkgDir(mainFile, name) {
  // Deliberately NOT "walk up until any package.json is found" — some
  // packages (bb.js among them) ship nested package.json files inside
  // their own build-output subdirectories (dual ESM/CJS "exports" marker
  // files), so that walk stops at the WRONG, much smaller directory
  // instead of the package's real root (confirmed the hard way: an
  // earlier version of this script vendored 4.8MB of bb.js instead of the
  // real ~140MB). Anchoring on the last literal `node_modules/<name>`
  // segment in the resolved path is exact regardless of internal package
  // layout.
  const marker = path.join("node_modules", ...name.split("/"));
  const idx = mainFile.lastIndexOf(marker);
  if (idx === -1) throw new Error(`Could not locate "${marker}" in resolved path ${mainFile}`);
  return mainFile.slice(0, idx + marker.length);
}

function copyDirDereferenced(src, dest) {
  const real = fs.realpathSync(src);
  const stat = fs.statSync(real);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(real)) {
      copyDirDereferenced(path.join(real, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(real, dest);
  }
}

const visited = new Map(); // package name -> resolved real directory

function resolveAndQueue(name, fromDir, queue) {
  if (visited.has(name)) return;
  let mainFile;
  try {
    mainFile = require.resolve(name, { paths: [fromDir] });
  } catch {
    // Some declared deps are optional/platform-specific and may not be
    // installed for this OS — skip rather than fail the whole vendor step.
    console.log(`  (skip, not resolvable here) ${name}`);
    visited.set(name, null);
    return;
  }
  const realMainFile = fs.realpathSync(mainFile);
  const dir = fs.realpathSync(pkgDir(realMainFile, name));
  visited.set(name, dir);
  queue.push({ name, dir });
}

function main() {
  const worker = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const queue = [];
  for (const name of Object.keys(worker.dependencies)) {
    resolveAndQueue(name, ROOT, queue);
  }

  for (let i = 0; i < queue.length; i++) {
    const { name, dir } = queue[i];
    const pkgJsonPath = path.join(dir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    const deps = { ...pkg.dependencies, ...(pkg.optionalDependencies || {}) };
    for (const depName of Object.keys(deps)) {
      resolveAndQueue(depName, dir, queue);
    }
  }

  fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(DEST, { recursive: true });
  let count = 0;
  for (const [name, dir] of visited) {
    if (!dir) continue;
    const destDir = path.join(DEST, ...name.split("/"));
    copyDirDereferenced(dir, destDir);
    count++;
  }
  console.log(`Vendored ${count} real package(s) into ${DEST}`);
}

main();

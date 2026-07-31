# Umbra matcher-worker

Standalone `match_orders` proving worker — completes matches the backend's
dark-engine has assembled but can't prove itself (`backend/` deliberately
doesn't run Noir/Barretenberg proving; see its own `src/dark-engine/prover.ts`).
**Never runs as part of the `backend/` deployment.** It talks to a running
backend purely over HTTP.

## Why a separate package

`@aztec/bb.js` ships a real WASM/CRS footprint — keeping it out of
`backend/`'s `package.json` means the constrained host that deployment runs
on never installs or loads it, even unused. This package is also built to
be self-contained (its own copy of the compiled circuit, see "Setup" below)
specifically so it can ship as an isolated deployment artifact — a Lambda
zip — rather than assuming it's always run from inside this monorepo
checkout.

## Setup

```bash
cd matcher-worker
npm install
cp .env.example .env   # fill in BACKEND_URL + MATCHER_INTERNAL_SECRET (must match backend/.env)
npm run sync-circuit   # copies contract/circuits/noir/match_orders/target/match_orders.json into ./circuit/
```

`sync-circuit` requires `contract/`'s compiled circuit artifact to already
exist — same one-time WSL2 toolchain setup as `contract/circuits/README.md`.
Re-run it whenever `match_orders/src/main.nr` changes and gets recompiled.

## Run locally

```bash
npm start            # polls forever, POLL_INTERVAL_MS apart
npm start -- --once  # single pass, then exit
```

For each `awaiting_proof` match: fetches its full proof inputs (private —
gated behind `MATCHER_INTERNAL_SECRET`, see `backend/src/dark-engine/dark-engine.routes.ts`),
runs the real `match_orders` circuit via Noir/UltraHonk, and posts the
resulting proof back to `POST /api/dark-engine/matches/:id/proof`. The
backend then submits it on-chain, re-lists any residual, and announces.

## Deploying to AWS Lambda (scheduled, no server to run yourself)

`src/lambda.ts` exports a handler that runs exactly one poll pass
(`pollOnce`) and returns — the `--once` behavior above, shaped for a
scheduled trigger instead of a CLI flag. Deployed as a plain zip (not a
container image): a production-only `node_modules` (incl. `@aztec/bb.js`)
comes to ~156MB, comfortably under Lambda's 250MB zip-deploy limit, so
there's no need for the extra ECR/container-image machinery a bigger bundle
would need.

```bash
npm run package-lambda     # tsc build + sync-circuit + stage a prod-only
                            # node_modules into lambda-build/

BACKEND_URL=https://your-backend.example.com \
MATCHER_INTERNAL_SECRET=... \
  ./scripts/deploy-lambda.sh
```

`deploy-lambda.sh` is idempotent (re-run after any code or config change —
zips `lambda-build/`, creates or updates the Lambda function + its IAM
role, and creates or updates an EventBridge rule that invokes it every
`POLL_MINUTES` minutes, default 5). See the script's own header comment for
every env var it reads. Tear down with the AWS console or
`aws lambda delete-function` / `aws events remove-targets` /
`aws events delete-rule` / `aws iam` role cleanup — not automated here,
since undoing infrastructure deserves an explicit, reviewed action rather
than a one-liner.

The ~51MB zip is staged through an S3 bucket
(`<function-name>-deploy-<account-id>`) rather than uploaded inline —
`aws lambda create-function --zip-file` sending the whole thing in one HTTP
request body proved unreliable at this size (repeatedly failed with
"Connection was closed before we received a valid response"); S3's chunked
upload doesn't have that problem. The script always uploads to the same
fixed key (`function.zip`), so re-deploys overwrite it in place rather than
accumulating a new object per run.

Cost: Lambda's own free tier (1M requests + 400,000 GB-seconds/month,
ongoing, not just during a trial credit) comfortably covers a job this
small running every few minutes indefinitely. The only steady cost is the
single ~51MB object sitting in that S3 bucket — a fraction of a cent/month.

## Verified

Two independent real end-to-end runs on Coston2 (real `placeOrder`s,
matched, proven by this worker, submitted on-chain, announced) — confirmed
via the Coston2 explorer, not just the exit code:

- An exact full-cross match.
- A genuine **partial fill** at realistic 18-decimal scale (a 50-token
  order fully filling against a larger FXRP order), settling with a real
  non-zero residual order commitment on-chain and the correct leaf count
  (`OrdersMatched` tx `0x940fdbc7e7b53aa2d05adfd1f64102a3a2cf20bb559f4d3c047405ed4cdf6340`).

Also smoke-tested from the exact packaged Lambda build (`lambda-build/`,
compiled `dist/` + production-only deps + relocated circuit path) — a real
proof generated from the packaged artifact itself, not just from `src/` via
`tsx`, before ever touching AWS.

# Umbra btc-deposit-worker

Standalone `btc_deposit` proving worker — completes BTC deposits the
backend's `btc-deposit` module has assembled inputs for but can't prove
itself (`backend/` deliberately doesn't run Noir/Barretenberg proving; see
its own `src/btc-deposit/mempool.ts`). **Never runs as part of the
`backend/` deployment**, and deliberately **not** folded into
`matcher-worker/`'s existing Lambda: that one is EventBridge-scheduled for
`match_orders` batching, a cadence BTC deposits have no reason to share
(there's no matching step to wait for — see
`contract/circuits/BTC_DEPOSIT_DESIGN.md`'s "Proving location" section).
Talks to a running backend purely over HTTP.

## Why a separate package

Same reasoning as `matcher-worker/`'s own README: `@aztec/bb.js` ships a
real WASM/CRS footprint, kept off the constrained `backend/` deployment
host entirely. This package is self-contained (its own copy of the
compiled circuit) so it can run wherever real proving compute is
available, independent of this monorepo's checkout layout.

## Setup

```bash
cd btc-deposit-worker
pnpm install
cp .env.example .env   # fill in BACKEND_URL + BTC_DEPOSIT_INTERNAL_SECRET (must match backend/.env)
pnpm run sync-circuit   # copies contract/circuits/noir/btc_deposit/target/btc_deposit.json into ./circuit/
```

`sync-circuit` requires `contract/`'s compiled circuit artifact to already
exist — same one-time WSL2 toolchain setup as `contract/circuits/README.md`.
Re-run it whenever `btc_deposit/src/*.nr` changes and gets recompiled.

## Run locally

```bash
pnpm start            # polls forever, POLL_INTERVAL_MS apart (default 3s — no batching reason to wait longer)
pnpm start -- --once  # single pass, then exit
```

For each `awaiting_proof` deposit: fetches its full proof inputs (private —
gated behind `BTC_DEPOSIT_INTERNAL_SECRET`, see
`backend/src/btc-deposit/btc-deposit.routes.ts`), independently computes
`checkpoint_commitment`/`note_commitment`/`nullifier` in TypeScript
(`src/poseidon2.ts`, mirroring `contract/circuits/noir/btc_deposit/src/
bitcoin.nr` exactly) since Noir requires every circuit input supplied at
witness-generation time regardless of which end up `pub`, runs the real
`btc_deposit` circuit, and posts the resulting proof back.

Errors are logged and left `awaiting_proof` for the next poll rather than
auto-marked failed — see `src/poll.ts`'s own comment for why (most
failures here are the checkpoint not yet having advanced far enough, a
transient condition, not a permanent one like dark-engine's
`NullifierAlreadySpent`).

## Deploying to AWS Lambda (scheduled, no server to run yourself)

`src/lambda.ts` exports a handler that runs exactly one poll pass
(`pollOnce`) and returns — the `--once` behavior above, shaped for a
scheduled trigger instead of a CLI flag. Same zip-not-container approach as
`matcher-worker/`'s own Lambda (see its README for the size/reliability
reasoning) — its own function and EventBridge schedule, **not**
`matcher-worker`'s: that one polls every 5 minutes for `match_orders`
batching, a cadence this flow has no reason to share.

```bash
pnpm run package-lambda     # tsc build + sync-circuit + stage a prod-only
                            # node_modules into lambda-build/

BACKEND_URL=https://your-backend.example.com \
BTC_DEPOSIT_INTERNAL_SECRET=... \
  ./scripts/deploy-lambda.sh
```

`deploy-lambda.sh` is idempotent (re-run after any code or config change —
zips `lambda-build/`, creates or updates the Lambda function + its IAM
role, and creates or updates an EventBridge rule that invokes it every
`POLL_MINUTES` minutes, default **1** — the minimum `rate()` granularity,
chosen because unlike `match_orders` there's no batching benefit to waiting
longer). See the script's own header comment for every env var it reads.
Tear down with the AWS console or `aws lambda delete-function` /
`aws events remove-targets` / `aws events delete-rule` / `aws iam` role
cleanup — not automated here, since undoing infrastructure deserves an
explicit, reviewed action rather than a one-liner.

The zip is staged through an S3 bucket (`<function-name>-deploy-<account-id>`)
rather than uploaded inline, same reliability reasoning as
`matcher-worker/`'s deploy script.

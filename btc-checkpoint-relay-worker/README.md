# Umbra btc-checkpoint-relay-worker

Standalone `checkpoint_relay` proving worker — keeps
`ShieldedVault.checkpoints[BTC_SIGNET_SOURCE_CHAIN_ID]` advancing with real,
proven 6-header hops instead of an admin write (see
`contract/contracts/ShieldedVault.sol`'s `extendCheckpoint` and its own
NatSpec). This is what replaces `refresh-btc-checkpoint.ts`'s old "run once
per deposit" role — see `contract/scripts/initialize-btc-checkpoint.ts`,
which now only bootstraps the one-time genesis anchor. **Never runs as part
of the `backend/` deployment**, and deliberately **not** folded into
`btc-deposit-worker/` or `matcher-worker/`'s existing Lambdas: this one paces
real signet block production (~10min/block), a cadence neither per-deposit
proving nor `match_orders` batching has any reason to share. Talks to a
running backend purely over HTTP — never holds a gas key itself (see "Why
the backend submits, not this worker" below).

## Why a separate package

Same reasoning as `btc-deposit-worker/`'s and `matcher-worker/`'s own
READMEs: `@aztec/bb.js` ships a real WASM/CRS footprint, kept off the
constrained `backend/` deployment host entirely. This package is
self-contained (its own copy of the compiled circuit) so it can run wherever
real proving compute is available, independent of this monorepo's checkout
layout.

## Why the backend submits, not this worker

`extendCheckpoint` is genuinely permissionless — no role check, no
timelock, anyone can call it (see that function's own NatSpec). It would be
valid for this worker to hold its own funded key and submit directly. It
doesn't, on purpose: every other worker in this monorepo (`btc-deposit-worker`,
`matcher-worker`) proves and hands the result to `backend/` over HTTP rather
than holding a signing key itself — `backend/src/shared/chain.ts`'s single
operator key is already the one place in this stack that touches the chain.
Adding a second, independently-funded signer for this worker would be a new
piece of key-management surface for no real benefit, so this one follows the
same pattern: prove here, submit there (`backend/src/btc-deposit/checkpoint-relay.ts`,
via the secret-gated `POST /api/btc-deposit/checkpoint/extend` route).

## Setup

```bash
cd btc-checkpoint-relay-worker
pnpm install
cp .env.example .env   # fill in BACKEND_URL + BTC_DEPOSIT_INTERNAL_SECRET (must match backend/.env)
pnpm run sync-circuit   # copies contract/circuits/noir/checkpoint_relay/target/checkpoint_relay.json into ./circuit/
```

`sync-circuit` requires `contract/`'s compiled circuit artifact to already
exist — same one-time WSL2 toolchain setup as `contract/circuits/README.md`.
Re-run it whenever `checkpoint_relay/src/*.nr` changes and gets recompiled.

## Run locally

```bash
pnpm start            # polls forever, POLL_INTERVAL_MS apart (default 10min — matches real signet block cadence)
pnpm start -- --once  # single pass, then exit
```

Each pass: reads the backend's currently-tracked checkpoint height (`GET
/api/btc-deposit/checkpoint`), checks how many real signet blocks have
confirmed past it, and — if at least `K=6` have — fetches those headers,
proves the real `checkpoint_relay` circuit, and submits the proof to the
backend's `POST /api/btc-deposit/checkpoint/extend`, which relays it on-chain
and updates its own tracker. A single pass loops internally through as many
6-header hops as the real chain currently supports, so one invocation (e.g.
one scheduled Lambda tick) fully catches up after downtime rather than
trickling forward one hop per poll interval. Requires
`contract/scripts/initialize-btc-checkpoint.ts` to have already registered a
genesis checkpoint — until then, every pass is a documented no-op (see
`src/poll.ts`'s own comment).

## Deploying to AWS Lambda (scheduled, no server to run yourself)

`src/lambda.ts` exports a handler that runs exactly one poll pass
(`pollOnce`) and returns — the `--once` behavior above, shaped for a
scheduled trigger instead of a CLI flag. Same zip-not-container approach as
the other workers' own Lambdas (see their READMEs for the size/reliability
reasoning) — its own function and EventBridge schedule, **not**
`btc-deposit-worker`'s or `matcher-worker`'s: those poll every 1 and 5
minutes respectively for their own reasons; this one defaults to 10 minutes,
matching real signet block production instead of an arbitrary short tick.

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
`POLL_MINUTES` minutes, default **10**). See the script's own header comment
for every env var it reads. Tear down with the AWS console or `aws lambda
delete-function` / `aws events remove-targets` / `aws events delete-rule` /
`aws iam` role cleanup — not automated here, since undoing infrastructure
deserves an explicit, reviewed action rather than a one-liner.

The zip is staged through an S3 bucket (`<function-name>-deploy-<account-id>`)
rather than uploaded inline, same reliability reasoning as the other
workers' deploy scripts.

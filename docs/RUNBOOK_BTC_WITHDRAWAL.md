# Runbook: Overdue BTC Withdrawal

Who this is for: whoever holds `BTC_CUSTODIAN_WIF` (deposit-intake hot wallet) or
one of the 3 reserve signer keys (`BTC_RESERVE_SIGNER_1/2/3_WIF` —
`backend/src/btc-withdrawal/reserve.ts`), responding to an overdue-withdrawal
alert. See `docs/THREAT_MODEL.md`'s "If the Custodian and Enough Reserve
Signers Simply Go Dark" section and `docs/LIMITATIONS.md` #7 for why this is a
manual procedure today rather than an automatic reclaim — there's a genuine
double-payment race that automatic reclaim would need to close first, and it
hasn't been built yet.

## What triggers this

A withdrawal has been nullified on-chain (`ShieldedVault`'s
`ExternalWithdrawalRequested` event fired, `isSpentNullifier` is already
`true`) but its off-chain Bitcoin payout hasn't landed within
`BTC_WITHDRAWAL_OVERDUE_MS` (default 6h). This is visible two ways:

- **Public, no auth needed**: `GET /api/btc-withdrawal/solvency` — check
  `overdueCount` (how many) and `oldestOverdueMs` (how long the worst one has
  been stuck). Poll this from whatever alerting/uptime tool is already
  watching the deployment; there's no push notification built yet.
- **Detail, secret-gated**: `GET /api/btc-withdrawal/overdue` with header
  `x-btc-withdrawal-secret: $BTC_WITHDRAWAL_INTERNAL_SECRET` — returns the
  actual `{ nullifierHash, status, amountSats, ageMs }[]` list so you know
  *which* withdrawal(s) to chase, not just that something's wrong.

## Triage: figure out why it's stuck

For each entry in `/overdue`, `GET /api/btc-withdrawal/:nullifierHash` (no
auth) returns the full record. Its `status` tells you which of two different
problems you're looking at:

### Status is `pending`

`attemptFulfillment` (`backend/src/btc-withdrawal/watcher.ts`) hasn't
succeeded in staging a PSBT yet. Check, in order:

1. **Is the withdrawal loop running at all?** Check the backend's own logs
   for `[btc-withdrawal]` lines around when this record was `observedAt`. If
   `BTC_CUSTODIAN_WIF` isn't set on this deployment, the loop never starts —
   that's a deploy config problem, not a transient one.
2. **Rate cap**: if `BTC_WITHDRAWAL_MAX_SATS_PER_HOUR`/`_PER_DAY` is
   configured, check `GET /api/btc-withdrawal/solvency`'s `rateCap` field.
   A record stuck `pending` with `spentSatsLastHour`/`spentSatsLastDay`
   sitting right at the cap will clear on its own once the trailing window
   rolls forward — no action needed, just wait (or raise the cap if this
   happens often and real payout volume has grown).
3. **Reserve balance**: check `reserveBalanceSats` in the solvency report.
   If it's below the withdrawal's `amountSats`, `sweep.ts` hasn't moved
   enough from the hot wallet yet, or the hot wallet itself is short. Check
   `custodianBalanceSats` too — if both are genuinely insufficient, this is a
   real solvency problem, not just a stuck withdrawal (see `solvent` field);
   escalate rather than continue this runbook.
4. **`failed` records nearby**: if this same nullifierHash previously
   transitioned to `failed` and got manually reset, or a sibling withdrawal
   around the same time shows `status: "failed"` with a `failureReason`, read
   that reason first — it may explain a systemic issue (e.g. mempool.space
   API errors) rather than something specific to this one record.

### Status is `awaiting_signatures`

A PSBT has been staged (`record.psbt` is set) but hasn't collected 2-of-3
reserve signatures yet. This is a human-coordination problem, not a code
problem:

1. Confirm the PSBT is actually fetchable:
   `GET /api/btc-withdrawal/:nullifierHash/psbt` with the withdrawal secret
   header. If this 404s or 409s, something raced it back to `pending` —
   re-check via the parent record instead.
2. Contact the 3 reserve signers directly (out of band — Slack, phone,
   whatever the team already uses; there's no in-app signer-notification
   system). Ask each to run
   `MODE=sign backend/scripts/sign-btc-withdrawal.ts` for this
   `nullifierHash` if they haven't already.
3. Each signer's script call is independent — they do **not** need to
   coordinate with each other or sign in any particular order.
   `POST /:nullifierHash/psbt` combines whatever signatures arrive via
   `bitcoin.Psbt.combine`, and auto-broadcasts the moment 2 valid signatures
   are present for every input.
4. If a specific signer is unreachable (lost key, unavailable person): the
   remaining 2 are still sufficient to reach the 2-of-3 threshold — this is
   exactly why the reserve is 2-of-3 and not 2-of-2 or 3-of-3. Confirm with
   the other 2 signers directly rather than waiting on the third.

## After it clears

Once broadcast, `status` becomes `broadcast`, `payoutTxid` is set, and the
record drops out of `/overdue` on the next check (`overdue.ts` only counts
`pending`/`awaiting_signatures`). No further action needed. If this happens
repeatedly for the same underlying cause (e.g. one signer is chronically
slow to respond), consider that a signal to either replace that signer or
shorten `BTC_WITHDRAWAL_OVERDUE_MS` so it pages earlier next time.

## What this runbook does NOT cover

- **Refunding the user instead of paying out**: not supported. There is no
  reclaim path — see `docs/LIMITATIONS.md` #7 for exactly why (the
  double-payment race an automatic reclaim would need to close). If a
  withdrawal is stuck for a reason that truly can't be resolved (e.g. every
  reserve signer's key is genuinely lost), that is a real fund-safety
  incident requiring a manual, case-by-case decision outside this document's
  scope — do not attempt to route around it with an ad hoc contract call.
- **Rotating a compromised key mid-incident**: if triage reveals a record is
  overdue because a key was *compromised* rather than merely unavailable,
  stop following this runbook and treat it as a security incident instead —
  rotate the affected key(s) (custodian: change `BTC_CUSTODIAN_WIF` and sweep
  immediately; reserve signer: this requires deriving a new reserve address
  with a replacement pubkey and migrating funds, since the 2-of-3 script is
  baked into the P2WSH address itself) before resuming normal operation.

# Threat Model & Security Boundaries

This document defines the trust assumptions, key roles, security invariants, and failure blast radiuses across the UMBRA architecture.

---

## 1. Trusted Parties & Key Roles

| Role / Key | Scope & Responsibility | Permissions & Capabilities |
| :--- | :--- | :--- |
| `PRIVATE_KEY` (Backend Operator) | Relays gasless transactions, settles matches, submits compliance screens. | Pays gas on behalf of users; holds `ATTESTER_ROLE` in `ComplianceRegistry`. Cannot steal user funds from `ShieldedVault`. |
| `BTC_CUSTODIAN_WIF` | Receives real signet deposit inflow (the address `btc_deposit` proofs pay into). No longer the final payout signer. | Controls signet custodian P2WPKH hot wallet (`tb1q...`). `sweep.ts`'s poll loop periodically moves its entire confirmed balance into the 2-of-3 reserve below, so real exposure is bounded to "whatever's arrived since the last sweep," not the bridge's full balance. |
| BTC reserve signer keys (`BTC_RESERVE_SIGNER_1/2/3_WIF`, held independently by 3 separate signers, never by this backend) | Sign real Bitcoin payout transactions for BTC withdrawals. | Jointly control a 2-of-3 P2WSH reserve address (`backend/src/btc-withdrawal/reserve.ts`) that funds every real payout via PSBT (`scripts/sign-btc-withdrawal.ts`). This backend derives and reads the reserve's public address but never holds a reserve private key — it can stage an unsigned PSBT but cannot sign or broadcast one alone. |
| `ShieldedVault` `DEFAULT_ADMIN_ROLE` | Contract admin actions: trusting deposit verifiers, registering deposit tokens, the BTC checkpoint genesis. | Held solely by a real, deployed 2-of-3 Safe (`contract/deployments/coston2-safe.json`) — **not** a single EOA; the original `CONTRACT_DEPLOYER` key renounced this role after the Safe was verified working. `setTrustedVerifier`/`setExternalDepositToken`/checkpoint genesis are additionally timelocked (`ADMIN_TIMELOCK_DELAY`, 48h) on this live contract — confirmed against its own on-chain bytecode. See `docs/LIMITATIONS.md` #6. |
| `CONTRACT_DEPLOYER` | Initial contract deployment only. | No longer holds any privileged role on the live `ShieldedVault` (see above) — retains ordinary EOA capabilities like deploying new, separate contracts. |
| User Wallet Keys | Client-side note spending and ownership keys (`spendingKey`, `ownerKey`). | Controls note nullification and spending authorization via client-side Noir ZK proofs. |

---

## 2. Blast Radius Analysis

### If Backend Operator Key (`PRIVATE_KEY`) is Compromised:
- **Blast Radius**: The attacker can drain the operator's Coston2 testnet gas balance by spamming transactions. The attacker could also mark arbitrary addresses as screened clear in `ComplianceRegistry`.
- **Mitigation / Fund Safety**: The attacker **CANNOT** drain deposits or steal funds from `ShieldedVault`. Every fund withdrawal, payment, or settlement requires a valid zero-knowledge proof whose nullifiers and commitments are verified on-chain by the respective Honk verifier contract.

### If Custodian Key (`BTC_CUSTODIAN_WIF`) is Compromised:
- **Blast Radius**: The attacker can only spend whatever the hot wallet is currently holding — real deposit inflow since `sweep.ts`'s last successful pass (`BTC_SWEEP_POLL_INTERVAL_MS`, default 30 min) — not the bridge's full balance. Everything already swept sits in the 2-of-3 reserve below, which this key has no power over at all.
- **Mitigation / Fund Safety**: Shortening `BTC_SWEEP_POLL_INTERVAL_MS` directly shrinks this window. The solvency report endpoint (`GET /api/btc-withdrawal/solvency`) separately surfaces `custodianBalanceSats` and `reserveBalanceSats` so the hot-wallet exposure at any moment is independently checkable, not just asserted. (Note: signet funds carry zero real-world monetary value).

### If a Reserve Signer Minority (< 2-of-3) is Compromised:
- **Blast Radius**: None on its own — payouts require 2-of-3 signatures over the reserve's P2WSH witness script, and this backend process never holds a reserve private key at all (only the public reserve address), so compromising the backend doesn't help an attacker sign anything.
- **Mitigation / Fund Safety**: An attacker needs a second, independently-held signer key before they can move reserve funds at all. Losing (not compromising) one signer key is non-fatal — the other 2 can still reach threshold via `scripts/sign-btc-withdrawal.ts`.

### If a 2-of-3 Reserve Signer Majority is Compromised:
- **Blast Radius**: The attacker could sign and broadcast a real payout draining the reserve's full balance, bounded by whatever payout rate cap is configured (`BTC_WITHDRAWAL_MAX_SATS_PER_HOUR`/`_PER_DAY`, see `rate-limit.ts`) — that cap is enforced by this backend before a PSBT is ever staged, so it still throttles even though the backend can't sign — without a cap set, still unbounded. (Note: signet funds carry zero real-world monetary value.)
- **Mitigation / Fund Safety**: Same detection surface as the custodian-key case — the solvency report's `reserveBalanceSats` and `rateCap` fields make an anomalous drain publicly observable while it's happening, not just after the fact.

### If the Custodian and Enough Reserve Signers Simply Go Dark (No Compromise, Just Unavailability):
- **Blast Radius**: Real withdrawal requests already nullified on-chain sit `pending`/`awaiting_signatures` indefinitely — no automatic timeout or reclaim path exists yet (see `docs/LIMITATIONS.md`). This is an availability/liveness gap, not a fund-theft one: no attacker gains anything, a legitimate withdrawer is just stuck waiting.
- **Observability / Mitigation**: `GET /api/btc-withdrawal/solvency`'s `overdueCount`/`oldestOverdueMs` fields (backed by `backend/src/btc-withdrawal/overdue.ts`, threshold configurable via `BTC_WITHDRAWAL_OVERDUE_MS`, default 6h) flag any withdrawal stuck past that threshold, and the secret-gated `GET /api/btc-withdrawal/overdue` route lists the specific stuck records for triage. See `docs/RUNBOOK_BTC_WITHDRAWAL.md` for the response steps once this fires. This makes the gap loudly visible early — it does not close it; closing it requires either an automatic reclaim path or custodian/signer bonding, both deliberately deferred (see LIMITATIONS.md for why).

### If a Single Safe Owner Key is Compromised:
- **Blast Radius**: None on its own — the Safe requires 2-of-3 signatures for every admin action, so a single compromised owner key cannot act alone.
- **Mitigation / Fund Safety**: An attacker would need to separately compromise a second owner's key (a different key, on a different machine) before they could act at all. Losing (not compromising) a single owner key is also non-fatal: the other 2 owners can still reach the 2-of-3 threshold.

### If a 2-of-3 Safe Majority is Compromised:
- **Blast Radius**: For `setTrustedVerifier`/`setExternalDepositToken`/checkpoint updates specifically, none instantly — these are timelocked (`ADMIN_TIMELOCK_DELAY`, 48h) on the live `ShieldedVault`. A compromised majority can queue a malicious change (e.g. trusting a rubber-stamp `depositExternal` verifier), but it becomes publicly visible (`AdminActionQueued` event) and cancellable for a full 48h before it can execute. Other admin actions on the vault (`setAsset`, `setComplianceRegistry`, `setExternalSourceAsset`) are not timelocked and would take effect immediately.
- **Mitigation / Fund Safety**: Anyone monitoring `AdminActionQueued` events can call the matching `cancel*` function during the 48h window if a change wasn't legitimate — but only another Safe signer (2-of-3) can actually do so; this is a detection/response window, not an automatic block.

### If Backend Database (Turso / LibSQL) is Lost or Corrupted:
- **Blast Radius**: Resting orders in the off-chain dark pool order book may need to be re-submitted.
- **Fund Safety**: On-chain funds in `ShieldedVault` are completely safe. On-chain Merkle tree leaves and nullifiers remain the source of truth. The backend can safely hydrate or rebuild its indices directly from blockchain event logs.

---

## 3. Core Security Invariants

1. **Proof Authorization Required for All State Transitions**: No asset in `ShieldedVault` can be transferred, withdrawn, or matched without a valid Honk proof verifying knowledge of the spending key, Merkle membership, and balance conservation.
2. **Double-Spend Prevention**: Every spend publishes a deterministic nullifier hash (`Poseidon2(commitment, spendingKey)`). The contract records spent nullifiers on-chain; any duplicate attempt reverts with `NullifierAlreadySpent`.
3. **Conservation of Balance**: In `match_orders`, the sum of outputs must strictly equal the sum of inputs. The circuit enforces pro-rata limit pricing and exact integer arithmetic.

---

## 4. Out-of-Scope Risks

- **Bitcoin Signet Deep Reorgs**: Bitcoin testnet/signet can occasionally experience reorganizations deeper than standard confirmations.
- **Client Endpoint Compromise**: If a user's browser or device is compromised, their client-side note storage (IndexedDB) and privacy keys could be exposed.

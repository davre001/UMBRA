# Threat Model & Security Boundaries

This document defines the trust assumptions, key roles, security invariants, and failure blast radiuses across the UMBRA architecture.

---

## 1. Trusted Parties & Key Roles

| Role / Key | Scope & Responsibility | Permissions & Capabilities |
| :--- | :--- | :--- |
| `PRIVATE_KEY` (Backend Operator) | Relays gasless transactions, settles matches, submits compliance screens. | Pays gas on behalf of users; holds `ATTESTER_ROLE` in `ComplianceRegistry`. Cannot steal user funds from `ShieldedVault`. |
| `BTC_CUSTODIAN_WIF` | Signs Bitcoin payout transactions for BTC withdrawals. | Controls signet custodian P2WPKH wallet (`tb1q...`). Can spend signet custodian UTXOs. |
| `CONTRACT_DEPLOYER` / Admin | Contract deployment & initial parameter configuration. | Upgrades or registers verifier addresses / checkpoint roots on Coston2 testnet contracts. |
| User Wallet Keys | Client-side note spending and ownership keys (`spendingKey`, `ownerKey`). | Controls note nullification and spending authorization via client-side Noir ZK proofs. |

---

## 2. Blast Radius Analysis

### If Backend Operator Key (`PRIVATE_KEY`) is Compromised:
- **Blast Radius**: The attacker can drain the operator's Coston2 testnet gas balance by spamming transactions. The attacker could also mark arbitrary addresses as screened clear in `ComplianceRegistry`.
- **Mitigation / Fund Safety**: The attacker **CANNOT** drain deposits or steal funds from `ShieldedVault`. Every fund withdrawal, payment, or settlement requires a valid zero-knowledge proof whose nullifiers and commitments are verified on-chain by the respective Honk verifier contract.

### If Custodian Key (`BTC_CUSTODIAN_WIF`) is Compromised:
- **Blast Radius**: The attacker could drain the custodian's Bitcoin signet balance.
- **Observability / Mitigation**: The solvency report endpoint (`GET /api/btc-withdrawal/solvency`) continuously verifies that `custodianBalanceSats >= outstandingObligationSats`. Any shortfall is immediately observable publicly and halts new payout operations. (Note: Signet funds carry zero real-world monetary value).

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

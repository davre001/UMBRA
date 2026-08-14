# Known Limitations & Simplifications

This document plainly states what is explicitly not handled, interim simplifications, and current boundaries in the UMBRA protocol. Reviewers and contributors can check these known gaps against current implementations.

---

## 1. Bitcoin SPV Checkpoint Refresh (Manual Admin Step)

- **Limitation**: The `btc_deposit` Noir circuit proves that a transaction was included in a block whose header is an ancestor of an on-chain checkpoint header. Currently, unblocking a proven BTC deposit requires an operator to execute `contract/scripts/refresh-btc-checkpoint.ts` to register the confirming block height.
- **Impact**: A deposit transaction may sit proven but unminted until the checkpoint header on Coston2 aligns with the deposit's block height.
- **Roadmap Target**: Automate the checkpoint updater via a dedicated keeper/watcher loop mirroring `btc-deposit`'s auto-minter pattern.

## 2. Compliance Attestation Trust Model (Interim `ATTESTER_ROLE`)

- **Limitation**: `ComplianceRegistry.sol` gates `withdraw()` using a centralized `ATTESTER_ROLE` key instead of verifying an on-chain Flare Data Connector (FDC) attestation proof.
- **Impact**: Sanctions screening decisions rely on the attester backend key executing screening rules rather than decentralized FDC consensus rounds.
- **Roadmap Target**: Replace `ATTESTER_ROLE` signature/direct write with verification of Flare Data Connector `JsonApi`/`Web2Json` attestation proofs against independent AML data sources.

## 3. Private Pay Sender Public Caller

- **Limitation**: While `pay()` stealth addresses hide the recipient on-chain via one-time ECIES stealth tags, the transaction calling `StealthAnnouncer.announce()` originates directly from the sender's wallet.
- **Impact**: The sender's address remains visible on-chain even though the recipient is shielded.
- **Roadmap Target**: Route payment announcements through the gasless relayer service to decouple the sender's EOA from the `announce()` event.

## 4. Off-Chain Proving Delegation

- **Limitation**: Server-side proving for `match_orders` and `btc_deposit` requires substantial compute (Noir + Barretenberg `bb.js`), which exceeds lightweight API container resources. Proving is delegated to dedicated worker processes or AWS Lambda workers.
- **Impact**: If proving workers are offline or unconfigured, dark pool matches rest in `awaiting_proof` status.

## 5. Single Operator Testnet Key Model

- **Limitation**: For Coston2 testnet convenience, the backend services (compliance attester, gasless relayer, and dark engine settlement) share a single funded operator key.
- **Impact**: In a production mainnet deployment, each service should use an isolated, minimally-privileged key with strict role separation.

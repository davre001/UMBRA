# External API Notes & Failure Modes

This document establishes the real, observed behavior, failure modes, idempotency guarantees, timeout semantics, and retry policies for every external integration in UMBRA.

---

## 1. Flare Coston2 JSON-RPC & Contracts

- **Client**: `viem` (`publicClient`, `walletClient`) connecting to `coston2Deployment.rpcUrl` (drpc / public endpoint).
- **Synchronous vs. Asynchronous**:
  - `readContract`: Synchronous read via `eth_call`.
  - `writeContract`: Asynchronous broadcast returning transaction hash `txHash`. Must be followed by `waitForTransactionReceipt`.
- **Failure Modes**:
  - `waitForTransactionReceipt` resolves on reverted transactions as well as successes. All transaction submissions MUST use `assertTxSuccess(receipt)` to verify `receipt.status === "success"`.
  - Rate limiting / block range caps: `eth_getLogs` is capped at 10,000 blocks per request on free tiers. Handled via chunked queries (`MAX_LOG_RANGE = 9999n`).
- **Idempotency & Re-execution**:
  - Smart contract calls that consume nullifiers (`withdraw`, `pay`, `matchOrders`, `depositExternal`) are protected by on-chain nullifier tracking. A duplicate attempt reverts with `NullifierAlreadySpent`.
- **Three-State Handling**:
  - **CONFIRMED**: Transaction receipt received with `status: "success"`.
  - **FAILED**: Transaction reverted on-chain with confirmed receipt (`status: "reverted"`).
  - **UNKNOWN**: RPC timeout, dropped connection, or node sync delay. Must be queried via receipt lookup before attempting resubmission to avoid nonce race conditions.

---

## 2. Flare Time Series Oracle (FTSOv2)

- **Target**: Contract `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d`, function `getFeedById(bytes21 _feedId)`.
- **Feed IDs**:
  - `C2FLR`: `0x01464c522f55534400000000000000000000000000` (FLR/USD)
  - `FXRP`: `0x015852502f55534400000000000000000000000000` (XRP/USD)
  - `USDT0`: `0x01555344542f555344000000000000000000000000` (USDT/USD)
  - `BTC`: `0x014254432f55534400000000000000000000000000` (BTC/USD)
- **Semantics**: Read-only (`view` via `eth_call`). Returns `(uint256 _value, int8 _decimals, uint64 _timestamp)`.
- **Failure Modes & Retries**:
  - Read failure throws structured error and logs feed ID. Read is strictly idempotent and safe to retry.
  - Pair pricing computes `from.value / to.value` with strict zero-division validation.

---

## 3. Bitcoin Signet Indexer APIs (Mempool Fallback Chain)

- **Endpoints (Fallback Chain)**:
  1. `https://mempool.space/signet/api`
  2. `https://blockstream.info/signet/api`
  3. `https://mempool.emzy.de/signet/api`
- **Observed Failure Modes**:
  - Hosting providers (e.g. Render) may have blocked IP ranges to specific indexers (e.g. Cloudflare challenge on mempool.space).
  - Public endpoints impose strict IP rate limits under burst traffic.
  - Solution: Automatic fallback iteration (`SIGNET_API_BASES`) across all three providers on any non-2xx status or connection timeout.
- **Operations**:
  - `GET /address/:addr/utxo`: Fetches confirmed UTXOs for custodian solvency and payout generation.
  - `GET /tx/:txid/hex`: Fetches raw transaction bytes for SPV Merkle inclusion proof assembly.
  - `POST /tx`: Broadcasts raw signed Bitcoin transaction. Returns txid string on success.
- **Idempotency**:
  - `POST /tx` is transport-idempotent: submitting an already-relayed transaction returns the existing txid or a known `txn-already-in-mempool` response.

---

## 4. Prover Workers (AWS Lambda / Standalone HTTP)

- **Endpoints**:
  - `matcher-worker`: `POST /prove` with serialized `MatchProofInputs`.
  - `btc-deposit-worker`: `POST /prove` with parsed Bitcoin block header and tx witness data.
- **Semantics**: Computationally intensive asynchronous proving. Returns Barretenberg UltraHonk proof byte array.
- **Failure Modes**:
  - Memory exhaustion or timeout during WASM proof generation.
  - In `dark-engine`, matches remain in `awaiting_proof` status until proof generation completes or is resubmitted.
- **Idempotency**: Prover execution is a deterministic pure function of its inputs.

---

## 5. Durable Storage (Turso / LibSQL SQLite)

- **Purpose**: Persisting off-chain resting orders and dark pool match lifecycles across container restarts.
- **Hydration Guard**: `hydrateFromStore()` MUST complete before HTTP server begins accepting traffic on `/api/dark-engine` routes to prevent duplicate order matching.
- **Table Operations**: `upsert` and atomic status transitions (`awaiting_proof` → `settled` / `failed`).

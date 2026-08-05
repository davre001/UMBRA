# Umbra Contracts

Hardhat + TypeScript project targeting Flare's **Coston2** testnet, built on
`@openzeppelin/contracts` and (for future FTSO/FDC/FAssets integration)
`@flarenetwork/flare-periphery-contracts` — real contract addresses are
resolved dynamically, never hardcoded.

## Setup

```bash
cd contract
npm install
cp .env.example .env   # fill in PRIVATE_KEY (a Coston2-funded deployer key)

# one-time circuit setup (needs WSL2) — full steps in circuits/README.md:
#   install nargo + bb, then per circuit: nargo compile && nargo execute,
#   bb prove -t evm --write_vk, bb write_solidity_verifier

npm run compile
npm test
npm run deploy:coston2
```

## Contracts

| Contract | Replaces backend module | Purpose |
| --- | --- | --- |
| `ShieldedVault.sol` | `vault`, `dark-engine` | Locks allowlisted assets (native C2FLR, plus ERC20s FXRP and USDT0) as **hidden notes** in a commitment Merkle tree — not a public balance mapping. `withdraw`/`pay`/`placeOrder`/`cancelOrder`/`matchOrders` are each gated by a real UltraHonk (Noir/Barretenberg) proof, verified on-chain. |
| `verifiers/*.sol` | `prover` | Generated (`bb write_solidity_verifier`) from `circuits/noir/*` — real zk-SNARK verification, using Aztec's public Ignition ceremony SRS, not a per-project trusted setup. |
| `lib/MerkleTreeWithHistory.sol`, `lib/poseidon2/` | — | Incremental commitment tree + the on-chain Poseidon2 hasher it needs (vendored, empirically verified against the circuits — see `circuits/README.md`). |
| `ComplianceRegistry.sol` | `compliance` | Records sanction-screen results; `ShieldedVault.withdraw` gates on `isScreened(recipient)`. |
| `OwnerKeyRegistry.sol` | — | Lets a wallet publish the public `ownerKey` its notes are credited to, so `pay`'s sender can look it up before building a note for that recipient — see `circuits/DESIGN.md`. Standalone; `ShieldedVault` doesn't read it. |
| `StealthAnnouncer.sol` | `stealth` | On-chain announcement log (same event shape EIP-5564 uses). The frontend's `pay` flow calls it to deliver a paid note's private data (assetId, amount, blinding) to its recipient — not full EIP-5564 stealth addressing, see `announcer.ts`'s own doc comment for the distinction. |
| `BatchWithdrawer.sol` | — | Permissionless call-forwarder for `withdraw()` — one wallet signature covers N independent withdrawals instead of N. Holds no funds, needs no constructor wiring (`vault` is a call-time parameter); each call is `try`/`catch`'d individually so one failing item doesn't block the rest. Built for the frontend's "Unshield All". |
| `mocks/MockERC20.sol` | — | Test-only mintable ERC20, never deployed to Coston2. |
| `UmbraForwarder.sol` | — | **Currently unused.** No forwarder is needed for withdraw/pay/order actions — the ZK proof itself is the authorization, so anyone can already submit those calls directly. Kept in case a real meta-tx use case (e.g. gasless `shield` via `ERC20Permit`) shows up later. |

`pricing` needs no new contracts — it reads the real `FtsoV2` directly (not yet
wired into these contracts).

## How the vault actually works

See [`circuits/DESIGN.md`](./circuits/DESIGN.md) for the full note/commitment/
nullifier scheme. Short version:

- **`shield`** needs no circuit — you compute a commitment client-side
  (`Poseidon2::hash([assetId, amount, ownerKey, blinding], 4)`, where
  `ownerKey` is your published public identifier, not your private
  spending key) and submit it alongside a plain, public deposit — an ERC20
  `transferFrom` for FXRP/USDT0, or the transaction's own native value for
  C2FLR (`nativeAssetId`, held directly — see `ShieldedVault.sol`, no
  wrapped-token contract involved). Nothing secret to prove yet.
- **`withdraw`**, **`pay`**, **`placeOrder`**, **`cancelOrder`**, and
  **`matchOrders`** each require a real UltraHonk proof (generated
  client-side, in the browser — spending keys never leave it) proving you
  know a note whose commitment is *some* leaf under the current root,
  without revealing which one, plus a nullifier only that note's owner
  could derive, so it can't be spent twice.
  - `withdraw` pays the asset out publicly (ERC20 transfer, or native value for C2FLR).
  - `pay` inserts a new hidden commitment instead, keeping funds inside the pool.
  - `placeOrder` spends a regular note and creates a hidden order commitment.
  - `cancelOrder` spends an order commitment and returns a regular note.
  - `matchOrders` spends two compatible order commitments and creates the
    two matched output notes — no `MATCHER_ROLE` or trusted matcher needed,
    the proof itself is the authorization.
- Compliance screening lives on `withdraw` (the point a plaintext recipient
  exists to screen) — private pay/order destinations are hidden
  commitments, nothing to screen until they're withdrawn.
- None of the above need ERC-2771/meta-tx machinery to be gasless: the ZK
  proof itself is the authorization, so literally anyone — including a
  fee-paying relayer — can already submit the call directly.

### Known simplification, v1

`withdraw`'s amount is public — unavoidably, since it's a plain on-chain
transfer and the contract needs the real value to move real funds. `pay`'s
amount is private (a straight 1-in-1-out passthrough needs no
value-conservation/range-proof machinery, unlike a real multi-note
join-split). Order amounts are private too — `placeOrder`/`cancelOrder`/
`matchOrders` never expose them. `matchOrders` supports real partial fills
(a fill can consume less than an order's full `amountIn`, leaving a smaller
residual order still on the book) but only matches two orders at a time —
no N-way matching in a single proof. See `circuits/DESIGN.md`.

## Network

- **Coston2** (chain id `114`) — RPC `https://flare-testnet.drpc.org` (the
  official `coston2-api.flare.network` endpoint caps `eth_getLogs` at 30
  blocks per query, too small for this app's leaf-history scans)
- Explorer: https://coston2-explorer.flare.network
- Faucet (real C2FLR / FXRP / USDT0): https://faucet.flare.network/
- Real FXRP/USDT0 addresses aren't hardcoded anywhere in this repo — look
  them up on the explorer and pass them to `deploy.ts` via
  `FXRP_ADDRESS`/`USDT0_ADDRESS` in `.env` (see `.env.example`). assetId is
  fixed by position: 0 = native C2FLR (no address — see `ShieldedVault.sol`'s
  `nativeAssetId`), 1 = FXRP, 2 = USDT0.

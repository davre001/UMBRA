# Circuits

Real UltraHonk circuits (Noir + Barretenberg), using Aztec's public
"Ignition" ceremony SRS — universal and reused across circuits, not a
bespoke per-circuit trusted setup. See [`DESIGN.md`](./DESIGN.md) for the
note/commitment/nullifier scheme these implement. Barretenberg has no native
Windows binary, so the toolchain runs in WSL2.

## One-time toolchain setup (WSL2)

```bash
curl -L https://raw.githubusercontent.com/noir-lang/noirup/refs/heads/main/install | bash
source ~/.bashrc && noirup

curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/refs/heads/next/barretenberg/bbup/install | bash
# WSL inherits Windows PATH, which can contain spaces ("Program Files") that
# break bbup's own PATH handling — run it with a clean PATH:
PATH="$HOME/.nargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" ~/.bb/bbup

nargo --version   # confirm
bb --version      # confirm
```

## Layout — one package per action

```
circuits/noir/
  lib/            shared primitives (commitment/nullifier/order hashing, Merkle proof) — not an action itself
  withdraw/       spend a note, pay out publicly
  pay/            spend a note, create a new hidden note
  place_order/    spend a note, create a hidden order commitment
  cancel_order/   spend an order commitment, create a refund note
  match_orders/   spend two order commitments, create the two matched notes
  btc_deposit/    prove a real signet Bitcoin payment, mint public WrappedBTC — see BTC_DEPOSIT_DESIGN.md
  checkpoint_relay/ prove a real K=6-header checkpoint extension — permissionless ShieldedVault.extendCheckpoint, see BTC_DEPOSIT_DESIGN.md
```

Each action circuit depends on `umbra_lib` (`{ path = "../lib" }`) and the
official `noir-lang/poseidon` package (`tag = "v0.3.0"` — the `v0.1.1` tag
the README shows first doesn't compile against current nargo, confirmed by
trying it before landing on `v0.3.0`).

`btc_deposit` is a different shape from the five action circuits above: it
doesn't spend/create notes at all (it binds a real EVM recipient address
directly, from a Bitcoin `OP_RETURN` output — see
[`BTC_DEPOSIT_DESIGN.md`](./BTC_DEPOSIT_DESIGN.md)), it's heavy enough
(~5,600 ACIR opcodes, dominated by two `sha256d` chains) that it's proven
server-side rather than in-browser (see that doc's "Proving location"
section), and its own worker package (`btc-deposit-worker/`) runs it
independently of `matcher-worker/`'s EventBridge cadence.

`checkpoint_relay` shares `btc_deposit`'s header/PoW/checkpoint math
(`verify_header_chain`, `verify_pow`, `checkpoint_commitment`) but proves
only that half of the statement, not the tx-inclusion/OP_RETURN-parsing
half — its `main()` proves a K=6-header extension from one checkpoint
commitment to the next, nothing else. Deliberately **not** a shared-lib
dependency on `btc_deposit`'s own `bitcoin.nr`: Noir `bin` packages (both of
these are) can't be depended on by another package, and hoisting the shared
logic into `umbra_lib` would touch `btc_deposit`'s module structure closely
enough to risk shifting its already-deployed verifier's VK — see
`checkpoint_relay/src/bitcoin_headers.nr`'s own header comment for the full
tradeoff. Its own worker package (`btc-checkpoint-relay-worker/`) paces real
signet block production (~10min/block), independent of both
`btc-deposit-worker/`'s and `matcher-worker/`'s own cadences.

## Compiling, proving, generating the Solidity verifier — per circuit

```bash
cd circuits/noir/withdraw   # or pay, place_order, cancel_order, match_orders, btc_deposit, checkpoint_relay
nargo compile
nargo execute witness       # needs Prover.toml with real input values

bb prove -b target/withdraw.json -w target/witness.gz -o target -t evm --write_vk
bb write_solidity_verifier -k target/vk -o target/Verifier.sol
```

`-t evm` selects keccak-based hashing and the ZK variant suited for on-chain
verification. The generated `HonkVerifier` contract's `verify(bytes proof,
bytes32[] publicInputs)` expects `publicInputs.length == circuitPublicInputs
- 8` — Barretenberg reserves 8 extra public-input slots for its pairing
/aggregation object, embedded in the proof bytes, not supplied by the
caller. Confirmed empirically by reading the generated contract's own
`require` check, not assumed.

Compiling more than one circuit also produces same-named `HonkVerifier`/
`RelationsLib`/`ZKTranscriptLib` contracts each time — renamed on copy into
`contracts/verifiers/` (`WithdrawHonkVerifier`/`WithdrawRelationsLib`/
`WithdrawZKTranscriptLib`, `PlaceOrderHonkVerifier`/... and so on) so
Hardhat can tell them apart and so the externally-linked libraries
(`RelationsLib`, `ZKTranscriptLib` — the ones Hardhat actually needs
`libraries: {...}` for) don't collide.

## On-chain Poseidon2 (for the Merkle tree, not the circuits)

`ShieldedVault`'s incremental Merkle tree needs Poseidon2 on-chain too, to
hash sibling nodes when inserting a new leaf. Vendored from
[`zemse/poseidon2-evm`](https://github.com/zemse/poseidon2-evm) (MIT) rather
than hand-written — see `contracts/lib/poseidon2/`. Its `hash_2` output was
empirically checked against `umbra_lib::hash_left_right`'s actual output for
three cases before being trusted (byte-for-byte match) — not assumed
compatible just because both are called "Poseidon2"; different
implementations of that name are not guaranteed to agree bit-for-bit.
`hash_1`/`hash_3`/variable-length `hash` were **not** independently
verified — the vault never calls them (commitment/nullifier hashing happens
client-side only, never on-chain).

## Running the vault's tests

`test/ShieldedVault.test.ts` uses real proof/public-input fixtures already
generated via the pipeline above (checked that they're present, not
regenerated per test run — this test suite doesn't drive `nargo`/`bb`
itself). Real in-browser proving via `@noir-lang/noir_js` + `@aztec/bb.js`
does exist, just in the frontend (`frontend/src/lib/proving/prove.ts`), not
in this Hardhat test file — its `@aztec/bb.js` version is pinned to match
the installed `bb`'s nightly build exactly (see that file's own comment). If
you change any circuit, regenerate its `target/proof`/`target/public_inputs`
via the steps above, copy them into `fixtures/`, copy the compiled
`target/<circuit>.json` into `frontend/public/circuits/`, and re-verify with
`circuits/scripts/noir-onchain-verify.ts` before running `pnpm test`.

`cancelOrder`/`matchOrders` are verified at the proof/verifier level (real
proof, real on-chain `verify()`, tamper-rejection — same rigor as every
other circuit) but not at the full vault-state-integration level in
`ShieldedVault.test.ts`: their fixtures assume an order commitment sitting
alone at leaf index 0, a state the vault's real functions can't reach in one
step (`placeOrder` always spends a *prior* note first). Chaining fixtures to
match a real multi-step sequence needs live in-test proving — see the
comment above `ShieldedVault.test.ts`'s `matchOrders` note for the full
reasoning. `matchOrders` specifically (including a genuine partial fill) has
been verified through a real multi-step sequence manually — two real
`placeOrder`s, matched, proven, submitted, settling with a correct residual
on-chain — see `matcher-worker/README.md`'s "Verified" section; that
verification just isn't part of this repo's checked-in automated suite.

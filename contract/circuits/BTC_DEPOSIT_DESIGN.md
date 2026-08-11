# BTC deposit circuit design

This is a **new** design-doc convention, specific to `btc_deposit` — it is
not a continuation of `DESIGN.md`'s existing structure (that file has one
shared "Known simplification, v1" section covering `withdraw`/`pay`/
`placeOrder`/`cancelOrder`/`matchOrders`; this file plays the same role for
`btc_deposit` alone, since the two circuit families don't share a design
history).

## Status: Phases 0-5 complete, verified on-chain

`ShieldedVault.depositExternal` — the `ExternalDeposit` struct, chain-tagged
`checkpoints`/`trustedVerifiers` registries, and admin setters
(`setTrustedVerifier`, `setCheckpoint`) — is implemented and tested in
`test/ShieldedVault.test.ts`: a real `btc_deposit` UltraHonk proof (real
sha256d header PoW, real Merkle-inclusion math, real Poseidon2
commitment/nullifier — see `fixtures/proof`/`fixtures/public_inputs`)
verifies on-chain and correctly mints a note, alongside adversarial tests
for an untrusted verifier, a stale/unregistered checkpoint, and nullifier
replay. `contracts/verifiers/BtcDepositVerifier.sol` follows this repo's
existing per-circuit renaming convention (`BtcDepositHonkVerifier`/
`BtcDepositRelationsLib`/`BtcDepositZKTranscriptLib`).

`scripts/deploy.ts` now deploys and trusts `BtcDepositHonkVerifier` too
(the checkpoint itself is deliberately left unregistered at deploy time —
see that script's own comment).

**Phase 6a/6b also done**: `backend/src/btc-deposit/` (real mempool.space
data fetching + fixed-template tx parsing, independently verified against
real chain data the same way the circuit's own tests were — see
`backend/test/btc-deposit.test.ts`) and a new standalone
`btc-deposit-worker/` package (real Noir/bb.js proving, mirroring
`matcher-worker/`'s pattern but with its own fast poll loop, not that
package's EventBridge-scheduled cadence). The worker's independently
computed TypeScript Poseidon2 values were cross-checked against `nargo
test`'s own known-good values (byte-identical), and the resulting
TypeScript-generated proof was independently verified against the real
on-chain `BtcDepositHonkVerifier` (`contract/scripts/
verify-btc-deposit-proof.ts`) — the full pipeline, Noir circuit through
TypeScript worker through Solidity verifier, is confirmed consistent
end-to-end, not just individually plausible.

One non-obvious `@aztec/bb.js` gotcha worth recording: its WASM backend's
default SRS/CRS size (2^19 points) is too small for `btc_deposit`'s
~15,600 ACIR opcodes — proving fails with `"prover trying to get too many
points in MemBn254CrsFactory"` unless `Barretenberg.new({ srsSize: ... })`
is passed an explicitly larger value. Calling `initSRSChonk` again on an
already-constructed instance does **not** reliably fix this — it must be
set at construction time. See `btc-deposit-worker/src/prove.ts`'s own
comment.

**Phase 6c also done**: `frontend/src/app/deposit-btc/page.tsx` — a
functional (not just typechecked) deposit flow reusing
`noteWallet.prepareDepositNote` for deterministic, recoverable blinding
(the same property `shield()` deposits already have), polling backend
status via TanStack Query, and submitting `depositExternal` through the
user's own connected wallet once proven. `api.ts` gained
`submitBtcDeposit`/`fetchBtcDepositStatus`.

Not yet done: actual AWS deployment of the worker, a live Coston2
deployment/checkpoint registration, and real BTC withdrawal (see
"Withdrawal is out of scope" below — this remains true even after the
guard described there).

## Withdrawal — built, and honestly custodial

The scope lock at the top of this document was never just "we haven't
built it yet" — `depositExternal` mints a note with **no real EVM-side
collateral locked in `ShieldedVault`** for it, unlike `shield()`. If
`withdraw()` ever paid a BTC-sourced note out as if it were real ERC20/
native collateral, it would drain other users' genuinely-backed shielded
funds — an insolvency bug, not a scoping choice. That constraint is still
true; what changed is that a real redemption path now exists on the other
side of it, rather than withdrawal being blocked outright.

**No new circuit was needed.** `withdraw`'s `recipient` public input was
already just an opaque 160-bit value the circuit doesn't interpret — its
own design note already says the payout destination can't be hidden
either way, since a plain transfer needs the real value to move real
funds. Reusing those same 160 bits to carry a Bitcoin P2WPKH pubkey hash
(hash160) instead of an Ethereum address costs nothing: same circuit, same
deployed `WithdrawVerifier.sol`, same proof shape.

**`ShieldedVault.isExternalSourceAsset` evolved from "hard block" to
"route to the redemption relayer."** It started (see the previous version
of this section, still in git history) as an unconditional revert,
disclosed explicitly as temporary — "until a redemption bridge exists."
Now that the bridge exists, `withdraw()` branches on it instead: for a
normal asset, the existing ERC20/native transfer path runs unchanged; for
an `isExternalSourceAsset` asset, no transfer is attempted at all (there's
still no real collateral to move) — instead it emits
`ExternalWithdrawalRequested(assetId, nullifierHash, destination, amount)`
for `backend/src/btc-withdrawal/` to fulfill on the real chain. Compliance
screening is skipped for this branch too — `recipient`'s bits are a
Bitcoin hash160 here, not a real Ethereum account, so running them through
`ComplianceRegistry` would screen an address that was never actually
being paid.

### The custodial relayer (`backend/src/btc-withdrawal/`)

- **`wallet.ts`** — the custodian's real signet keypair (`BTC_CUSTODIAN_WIF`),
  the one genuine fund-custody secret anywhere in this repo. Its P2WPKH
  address must be the same address the deposit side's `VAULT_PUBKEY_HASH`
  points to (deposits pay in, withdrawals pay out — one address, two
  directions).
- **`watcher.ts`** — polls for `ExternalWithdrawalRequested` events
  (filtered to `BTC_ASSET_ID`; a future external asset would need its own
  filter, not this one), same chunked-`getLogs` pattern
  `shared/scan.ts` already uses for the 10,000-block RPC cap.
- **`bitcoin-tx.ts`** — builds and signs a real P2WPKH transaction via
  `bitcoinjs-lib` (largest-first UTXO selection, iterative fee estimation,
  change dropped as dust below 546 sats) and broadcasts via
  `mempool.space` — free, no node required, same as the deposit side's
  data fetching. Tested with **real, independent signature verification**
  (recomputing the sighash and checking it against the witness's own
  signature/pubkey directly, not just "it didn't throw") against a
  throwaway generated keypair — never a real key — in
  `backend/test/btc-withdrawal.test.ts`.
- **`store.ts`** — idempotency keyed by `nullifierHash` (the natural,
  already-unique on-chain identity for a withdrawal — no separate id
  needed). **The in-memory-only gap disclosed in the previous version of
  this section is now closed**: `store.ts` uses the exact same
  Turso-backed write-through pattern `dark-engine/store.ts` already
  established (unconfigured — no `TURSO_DATABASE_URL`, or `NODE_ENV=test`
  — is a no-op, identical to the old in-memory-only behavior; local dev
  and CI need no Turso account). Both `records` and `lastProcessedBlock`
  are persisted, and `index.ts`'s `startBtcWithdrawalWatcher` hydrates
  from the store before the first poll tick ever runs — the one ordering
  requirement that actually matters here, since a tick running against an
  empty in-memory store on a fresh restart was exactly the double-payout
  risk this closes. `backend/test/btc-withdrawal-store.test.ts` covers the
  in-memory semantics the write-through sits on top of (mutation
  transitions, idempotent no-ops on an unknown nullifierHash,
  `lastProcessedBlock` tracking) — same convention as the rest of this
  repo's Turso-backed stores, which don't test against a real Turso
  account either.

### Solvency — what's actually checkable, and what isn't

The original idea for this was "a running counter: total BTC-notes minted
minus total withdrawal-requested." That doesn't actually work: a BTC
deposit's amount is hidden inside its Poseidon2 `note_commitment` by
design — `ExternalDeposited` never emits a plaintext amount to sum, unlike
`ExternalWithdrawalRequested`'s `amount`, which is public for the same
reason `withdraw`'s amount already is for every other asset.

What `backend/src/btc-withdrawal/solvency.ts` computes instead —
**the custodian's real current BTC balance vs. the sum of currently
outstanding (not-yet-broadcast) withdrawal obligations** — is both the
achievable computation and the more directly useful one: it answers "can
pending withdrawals actually be paid right now," not a historical total
nobody could verify anyway. `GET /api/btc-withdrawal/solvency` is
unauthenticated on purpose — the custodian address, its real balance
(free via `mempool.space`), and every `ExternalWithdrawalRequested` event
are all independently, publicly checkable; this endpoint only saves
someone the arithmetic, it isn't the sole source of truth for it.

### The honest limit

Nothing cryptographic stops the custodian from simply not paying out a
withdrawal that's already nullified on-chain. The solvency counter makes
that **visible**, not impossible — the same disclosed-not-hidden
discipline as every other simplification in this document, just applied
to the one piece of this whole build that's genuinely custodial rather
than pure cryptography. A collateralized-agent model (the direction
Flare's own FAssets system takes) is the real fix for this, and remains
out of scope here.

## Public-input interface — one Field per `pub` value, not one per Noir type

`main()`'s public interface went through one real correction worth
recording. Phase 2 originally declared `checkpoint_hash: pub [u8; 32]` — 32
individual `pub u8` values. Barretenberg's `verify(bytes proof, bytes32[]
publicInputs)` allocates exactly one `bytes32` slot per `pub` **Field**
value in the circuit, regardless of the Noir-level type grouping them —
so that declaration silently meant **32 separate public-input slots**, not
one `bytes32`, an expensive mismatch to discover after `ShieldedVault.sol`
and a generated `Verifier.sol` were already built assuming a single
`bytes32 checkpointRoot` struct field (exactly the trap this plan's own
opening section warned about).

**Fix**: `checkpoint_hash` is now a *private* witness; the public input is
`checkpoint_commitment_pub: pub Field` — its Poseidon2 commitment via
`bitcoin::checkpoint_commitment` (`Poseidon2::hash([lo, hi], 2)` over the
hash's two 128-bit limbs, reusing `umbra_lib::hash_left_right` — the same
primitive every other commitment in this project already uses, not a new
hashing scheme). `main()` asserts the private `checkpoint_hash` matches the
public commitment before using it. This collapses the public interface to
exactly one Field/`bytes32`, matching `ExternalDeposit.checkpointRoot`
cleanly, and means `ShieldedVault.checkpoints[sourceChainId]` must store
this **commitment**, not the raw checkpoint hash — whatever registers a
checkpoint (Phase 6 tooling or a manual admin call) must compute it the
same way: split the 32-byte hash into low/high 16-byte limbs, cast each to
a Field, `Poseidon2::hash([lo, hi], 2)`.

## Proving location — resolved, not browser-side

Measured (not assumed) via `nargo info` after Phase 1's single-header PoW
check compiled: **911 ACIR opcodes, 682 Brillig opcodes** for `main`, driven
by two `sha256::digest` calls (sha256d). For comparison, this repo's
browser-proven circuits (`withdraw`, `pay`) are 130-134 ACIR opcodes with
zero Brillig; `match_orders` — already proven server-side by
`matcher-worker`, specifically because it's heavier than the browser
circuits — is 485 ACIR / 17 Brillig. A single Bitcoin header's PoW check
alone is already ~2x `match_orders`' full ACIR count. Phase 2's K = 6
header chain multiplies the sha256d cost roughly 6x further, before Phase
4 adds a Merkle-inclusion proof and output-script parsing on top.

**Conclusion: `btc_deposit` will not be added to
`frontend/src/lib/proving/prove.ts`'s browser-side `CircuitName` union.**
Phase 6 needs a genuinely server-side proving path. Per the explicit
instruction this plan was built under: not a relabeled `matcher-worker` —
that Lambda is architecturally a scheduled EventBridge poller ("is there a
match waiting"), not a shape suited to an on-demand, single-request proving
job. Phase 6 will define a new, honestly-named service for this.

Confirmed again after Phase 2's real K = 6 chain compiled: **5,630 ACIR
opcodes** for `main` (vs. Phase 1's 911 for one header — the ~6x scaling
this section predicted, confirmed rather than assumed). Native (non-WASM)
wall-clock on this dev machine: witness generation ~1.6s, `bb prove`
~3.8s — already ~4x match_orders-scale proving effort natively, before
accounting for the typical 5-20x slowdown WASM/browser proving carries
relative to native. Phase 4's Merkle-inclusion adds ~20 Poseidon2 levels on
top (cheap — comparable to `withdraw`'s existing Merkle check), so the
sha256d calls, not the Merkle path, are and will remain this circuit's cost
driver.

## Scope lock

One-way deposit only: prove a real Bitcoin **signet** payment happened,
mint a private UMBRA note from it. No withdrawal, no custody, no relayer
paying out real BTC — that's a separate Roadmap item, not this build.

## What the circuit proves

Given a bounded header chain anchored at a disclosed checkpoint, plus a
transaction and its Merkle-inclusion path under one of those headers' merkle
roots: that a specific Bitcoin signet payment happened, and mints exactly
one UMBRA note commitment (plus a chain-namespaced nullifier) from it. See
`ExternalDeposit`/`depositExternal` in `ShieldedVault.sol` for how this
plugs into the vault's existing note-insertion path (same `_insert` call
`shield()` already uses) and how the chain-tag/nullifier-namespacing keeps
this generalizable to a future Ethereum deposit circuit without a storage
migration.

## Known simplifications, v1 — written before any circuit code

**Checkpoint trust assumption.** The circuit does not validate Bitcoin's
full history back to genesis. It trusts one recent, disclosed signet header
hash (`checkpoint_hash`, a public input, matched on-chain against
`ShieldedVault`'s `checkpoints[sourceChainId]`) as its root of trust, and
only proves that the header chain supplied as a private witness correctly
extends forward from it. This is the same checkpoint-trust model BTC Relay
and every practical SPV client use — validating consensus from genesis
in-circuit is a different, much larger scope. Whoever controls what value
gets registered as the trusted checkpoint (initially, this project's own
deployer) is trusted not to register a checkpoint from a forged or
minority-fork chain. Rotating/updating the checkpoint is an on-chain admin
action, not something this circuit itself proves.

**Fixed header-chain length, K = 6.** The circuit takes exactly 6 headers
as a private witness (roughly an hour of signet blocks). A payment whose
confirming block is further than 6 blocks past the checkpoint can't be
proven with a single proof under this v1 design — the checkpoint itself
would need updating first. K is a circuit-level constant (`umbra_lib`-style
global), not configurable per-proof.

**Signet's signer-check is not verified — only proof-of-work is.**
Signet headers carry an additional constraint mainnet/testnet don't: a
valid header must also satisfy a federation signature check (embedded in
the coinbase transaction's witness commitment, verified against a
challenge script agreed on for the given signet). This circuit checks only
`sha256d(header) < target_from(bits)` (Phase 1) and correct `prev_hash`
chaining from the checkpoint (Phase 2) — it does **not** parse or verify
the signet signer challenge. This is a deliberate, disclosed v1 gap: on
mainnet, PoW alone is the real security property (that's what "proof of
work" means); signet's extra signer check exists so a low/trivial-PoW test
network can't be trivially forked or spammed by anyone in the world, but
the checkpoint-trust assumption above already provides that same
anti-forgery property for this circuit's purposes — anyone attempting to
feed the circuit a fake header chain would need it to both satisfy real
sha256d-under-target PoW *and* correctly chain from the checkpoint, which is
already infeasible to fabricate without knowing the real signet chain.
Skipping the signer check narrows what's cryptographically proven (a real
attacker with signet's federation key, or one who mines a low-difficulty
fork, is out of scope) but does not by itself allow forging an arbitrary
deposit against the real, currently-extending signet chain. Verifying the
signer challenge in-circuit is deferred, not because it's unimportant, but
because it requires parsing the coinbase witness commitment and signature
verification against the specific signet challenge script — real added
scope with no Phase 1-4 equivalent.

**Difficulty retarget validation is not implemented — deliberately, after
confirming the actual boundary, not assuming one.** Checked (not assumed)
against real mempool.space signet data: `bits` is constant across heights
0-2015, then changes exactly at height 2016, and again changes between
some later same-magnitude-apart heights — confirming this signet instance
retargets on the same 2016-block interval as mainnet, not some
signet-specific shorter interval. K = 6 (roughly an hour of blocks) is
tiny relative to a 2016-block epoch, but a chosen 6-header window landing
across a retarget boundary is not literally impossible — roughly a 6/2016
(~0.3%) chance for a window starting at an arbitrary height. This circuit
does not validate that a header chain's claimed `bits` sequence follows
Bitcoin's retarget formula at an epoch boundary; a proof attempted across
such a boundary would still correctly reject any header whose `bits`
doesn't match its *own* real hash (verify_pow still holds per-header), it
just wouldn't validate that a `bits` *change* mid-chain was the
consensus-correct one. Practical impact is availability, not soundness: on
the rare window that straddles a boundary, proving simply fails (a false
negative on an otherwise-valid deposit) rather than accepting anything
incorrect — the affected depositor would need the checkpoint advanced past
the boundary first, or wait for the next window. Treated as an acceptable
v1 gap given the low frequency and non-security nature of the failure mode;
implementing the actual retarget formula (recorded here for later, not
built now) would need the checkpoint's own epoch starting timestamp as an
additional public input to compute the expected new target.

**Inherited, disclosed soundness caveat from the `sha256` dependency
itself, not this project's code.** `nargo compile` on this circuit emits a
non-fatal warning — `bug: Brillig function call isn't properly covered by a
manual constraint`, pointing at `noir-lang/sha256 v0.3.0`'s internal
`build_msg_block_helper` — every time `bitcoin::double_sha256` is called.
This is a known, currently-open upstream issue
([`noir-lang/sha256#61`](https://github.com/noir-lang/sha256/issues/61)):
`sha256_var`'s Brillig-accelerated message-block construction isn't fully
re-constrained after its unconstrained execution, on current nargo
versions. Confirmed (not assumed) that: it does not block `nargo compile`
without `--deny-warnings` (this project's build does not pass that flag —
exit code 0, `target/btc_deposit.json` is produced); the upstream author's
own local experiment replacing the unsafe path with fully-constrained
message-block construction fixes it but changes the compiled circuit's
bytecode/verification key, so it isn't a drop-in patch. **This project
takes the warning as-is rather than vendoring a patched `sha256`,** since
patching would need to be re-applied on every dependency bump and this repo
has no other precedent for vendoring a modified third-party circuit
dependency (`contracts/lib/poseidon2/` is vendored Solidity, not Noir, and
is unmodified upstream code, not a patch). Revisit if upstream ships a fix,
or before any deployment handling real (non-testnet) value.

**Single asset (BTC only).** Unlike a future Ethereum deposit circuit
(which would need to distinguish a plain ETH transfer from an ERC-20
`Transfer` event), Bitcoin only ever represents one asset. The circuit and
`ExternalDeposit.sourceChainId`/nullifier-namespacing tag every deposit as
`"BTC_SIGNET"` — there is no asset-selection field because there is nothing
to select.

## Payment template — fixed shape, and why it isn't optional

The plan's original Phase 4 text ("parse the output script to extract the
paid amount") under-specifies a real problem: proof construction happens
on Flare, separately from and *after* the real Bitcoin payment. If a note's
`owner_key` were only a private witness supplied at proving time — the
same way `pay`/`withdraw`'s private witnesses work — anyone who observed
the confirmed Bitcoin payment could construct the depositExternal proof
themselves, with their *own* `owner_key`, and mint the note for themselves
instead of the real depositor. Nothing about "who signed the Bitcoin
transaction" would be checked at all.

**Fix: the deposit transaction itself carries the recipient's `owner_key`,
not just the payment.** The circuit only accepts a fixed transaction shape
— one input (empty scriptSig; the input's own script/witness type is
irrelevant, since txid depends only on the *non-witness* serialization,
identically shaped whether the input is P2WPKH, P2WSH, or P2TR) and
exactly two outputs:

```
output 0: OP_RETURN, 0 value, 34-byte script (OP_RETURN + push32 + 32-byte owner_key)
output 1: P2WPKH payment to UMBRA's fixed vault pubkey hash
```

`owner_key` is extracted directly from output 0 and used as-is — no
separate "claim" step, no trust in whoever submits the proof. Since
`owner_key` is already meant to be public (see `DESIGN.md`: "safe to
publish"), embedding it in the clear costs nothing privacy-wise. Only the
real depositor could have produced a Bitcoin transaction carrying their own
`owner_key` (they signed it), so the resulting note's ownership is fixed by
the real payment, not by proof-submission order.

**This makes `depositExternal` proof construction permissionless — a
deliberate, disclosed departure from every other circuit in this repo.**
`withdraw`/`pay`/`placeOrder`/etc. all need a private `spendingKey` only
the note's owner holds; `btc_deposit`'s witnesses (header chain, tx bytes,
Merkle path) are all public chain data once the Bitcoin payment confirms —
anyone could construct a valid proof for anyone else's confirmed deposit.
This is not a fund-safety issue: the resulting note is always owned by the
`owner_key` embedded in the real Bitcoin transaction regardless of who
submits the Flare-side proof, the same way anyone can relay someone else's
already-signed Ethereum meta-transaction without being able to change what
it does. Worth knowing, not worth guarding against.

**`amount` (satoshis) stays a Bitcoin-protocol little-endian field** —
UMBRA doesn't control that encoding, unlike `owner_key`'s big-endian
encoding, which is UMBRA's own choice (documented in `bitcoin.nr`) to match
this stack's existing bytes32/Field conventions rather than Bitcoin's.
Whoever builds the off-chain "construct a deposit transaction" tooling
(Phase 6) must encode `owner_key` big-endian into the OP_RETURN push, or
proofs will fail to extract the intended recipient.

**`VAULT_PUBKEY_HASH` is now the real deployed vault address** (2026-08-10):
`tb1qrmq4qvr3qmcn5s6yxlcr7y80cry0530n99g2mm`. Changing this constant
changes the compiled circuit's bytecode and VK — everything downstream was
regenerated to match: `bitcoin.nr`'s constant, every fixture/test in
`main.nr` that encodes a destination (`synthetic_deposit_tx`,
`synthetic_deposit_tx_v2`, and the header-chain fixture whose tip
`merkle_root` derives from the now-different txid), `Prover.toml`,
`fixtures/proof`/`fixtures/public_inputs`,
`contracts/verifiers/BtcDepositVerifier.sol`, `backend/.env`'s
`BTC_VAULT_PUBKEY_HASH`/`BTC_CUSTODIAN_WIF`, `backend/test/
btc-deposit.test.ts`'s `VAULT_HASH`, and `btc-deposit-worker/circuit/
btc_deposit.json`. All regenerated fixture bytes were built
programmatically (never hand-typed hex) after two transcription errors
were caught by an `assertLen` check mid-generation — worth noting since
it's the same class of mistake this document has warned about
throughout, and it still happened, and the guard caught it. The private
key lives only in `backend/.env` (gitignored), never in this repo or
this document.

**Exactly 1 input / exactly 2 outputs, no more — a real, meaningful
scope boundary, not a technicality.** Arbitrary Bitcoin transactions need
dynamic-length parsing (variable input/output counts, variable script
lengths) — real added scope, deferred, not built here. A typical wallet's
"send with change" produces a 2-output transaction where neither output is
this template's OP_RETURN slot, so depositors will likely need to
construct this exact shape deliberately (e.g. a "send exact, no change"
transaction, or purpose-built tooling) rather than using an arbitrary
wallet's default send flow. This is a genuine UX constraint worth solving
in Phase 6, not a hidden gap.

**Fixture data note.** `verify_tx_inclusion` (the Merkle-path algorithm)
is tested against a 100% real, naturally-occurring signet transaction and
its real mempool.space Merkle proof, cross-checked independently before
trusting it — same discipline as Phases 1-3. `parse_deposit_tx` (the fixed
OP_RETURN+P2WPKH template above) is necessarily tested against a
hand-built, synthetic transaction instead: this 2-output shape is a
brand-new convention this project is defining, so no real historical
example of it exists on-chain yet to fetch. Its dependency — txid
computation via sha256d — is separately real-data-verified.

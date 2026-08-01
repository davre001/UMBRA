# Note / commitment / nullifier design

Shared design every circuit (`withdraw`, `pay`, `placeOrder`, `cancelOrder`,
`matchOrders`) builds on. Adapted from Tornado Cash's commitment/nullifier
pattern, extended for variable amounts and multiple assets instead of one
fixed denomination.

## A note

```
note = { assetId, amount, ownerKey, blinding }
ownerKey = Poseidon2(spendingKey, 0)   // published; the private spendingKey never leaves its owner's browser
```

- `spendingKey` — a wallet's own persistent private key, derived once from a
  wallet signature and reused across every note that wallet owns.
  `ownerKey` is the public value derived from it — safe to publish (e.g. via
  `OwnerKeyRegistry`), since it doesn't let anyone spend the note, only
  build one *for* that owner.
- `blinding` — fresh per note (random field element). Without it, two notes
  with the same amount/asset credited to the same owner would collide on
  the same commitment.
- `amount` — token amount (raw units, same as the ERC20's own decimals).
- `assetId` — the allowlisted token's index in `ShieldedVault` (not the raw
  address, to keep the hashed field small).

```
commitment    = Poseidon2(assetId, amount, ownerKey, blinding)   // public, inserted as a tree leaf on shield
nullifierHash = Poseidon2(commitment, spendingKey)                // public, revealed on spend
```

Only whoever holds `spendingKey` (the preimage of a note's `ownerKey`) can
compute its `nullifierHash` — and since it's bound to that note's specific
`commitment`, the same `spendingKey` never produces the same nullifier for
two different notes, even though it's reused across all of that wallet's
notes. This is what makes a note payable to someone else (`pay`, and
`matchOrders`'s two output notes): the sender only ever needs the
recipient's public `ownerKey`, never anything that would let the sender
spend it themselves.

`shield()` needs no circuit: the commitment is computed client-side and
submitted alongside a plain, public ERC20 `transferFrom`. There's nothing
secret to prove yet — you're publishing a commitment, not spending one.
`ShieldedVault` just inserts it as a new leaf (see Merkle tree below).

### Paying a different recipient

Building a note "for" someone else only requires their public `ownerKey` —
but a wallet address alone doesn't reveal it (deriving it needs that
wallet's own signature). `OwnerKeyRegistry` is a small standalone contract a
wallet registers its `ownerKey` on once; `pay` looks up the recipient's
address there before building the output commitment. If a recipient hasn't
registered, `pay` has nothing to build a note against and refuses rather
than inserting an unspendable leaf.

## Spending a note (`withdraw` / `pay`)

Both circuits prove the same core statement: *"I know a note whose
commitment is one of the leaves under this Merkle root, and here is that
note's nullifier hash, which hasn't been spent before."* Neither reveals
*which* leaf — that's the anonymity set.

**Private inputs:** `spendingKey`, `blinding`, `amount`, `pathElements[20]`,
`pathIndices[20]` (Merkle path to the leaf) — `pay` additionally takes
`outOwnerKey`, `outBlinding` as private witnesses for the note it creates.

**Public inputs:**
- `withdraw`: `root`, `nullifierHash`, `amount`, `assetId`, `recipient`.
- `pay`: `root`, `nullifierHash`, `assetId`, `outCommitment` — `amount` is
  private (see "amounts" below).

**Circuit constraints:**
1. `commitment === Poseidon2(assetId, amount, Poseidon2(spendingKey, 0), blinding)`
2. `nullifierHash === Poseidon2(commitment, spendingKey)`
3. Merkle path from `commitment` up to `root` is valid (20 Poseidon2 hashes,
   direction picked per-level by `pathIndices`)
4. `withdraw` only: `recipient` is a public input, so already bound to the
   specific proof by the verification equation itself — no relayer can swap
   it after the fact. `pay` only: `outCommitment === Poseidon2(assetId,
   amount, outOwnerKey, outBlinding)` — the circuit recomputes the output
   note from the *same* `amount`/`assetId` as the note it's spending and
   checks it matches, so a valid proof can't pair a real spent note with an
   arbitrary, uncapped output value. (An earlier version of this circuit
   skipped this check — a self-referential `assert(outCommitment ==
   outCommitment)` that was always true regardless of `outCommitment`'s
   actual value, letting anyone spend a trivial note and mint an arbitrary
   output note. Fixed before this note was written; see the circuit's own
   `test_pay_rejects_mismatched_output_value`.)

`ShieldedVault` then: checks `root` is a known root, checks `nullifierHash`
hasn't been seen before, marks it spent, and either transfers the public
ERC20 out (`withdraw`) or inserts `outCommitment` as a new leaf (`pay`).

## An order (dark pool)

```
order = { ownerKey, blinding, amountIn, assetIn, assetOut, minAmountOut }
orderCommitment = Poseidon2(ownerKey, blinding, amountIn, assetIn, assetOut, minAmountOut)   // 6 inputs
```

Poseidon2's sponge IV depends on input count, so a 6-input order commitment
can never collide with a 4-input regular note commitment — both kinds of
leaf share the same Merkle tree without ambiguity about which circuit is
allowed to open which leaf.

Unlike `withdraw` (fully public payout) and `pay` (private amount, public
asset), an order's amounts *and* assets stay **private** —
`placeOrder`/`cancelOrder`/`matchOrders` only expose nullifiers and opaque
commitments as public inputs. Only the matcher, who receives order details
off-chain (encrypted, the same intent-submission flow the rest of the app
already assumes), knows what's actually in an order. This is a materially
stronger privacy property than `withdraw`/`pay` give you, and it's possible
here specifically because nothing about an order needs to become a public
on-chain value the way a `withdraw` payout does.

An order is owned by `ownerKey = Poseidon2(spendingKey, 0)` — the **same**
persistent `spendingKey` that owns this wallet's regular notes (not a
separate per-order secret, as an earlier version of this design used).
That reuse is what makes partial fills work cleanly: when `matchOrders`
only partly consumes an order, the leftover re-commits as a smaller
residual order under that same `ownerKey`, spendable later the exact same
way the original was — the trader doesn't need to have supplied anything
new for that to happen, since the matcher never needed a fresh secret from
them in the first place. The tradeoff: because `matchOrders` is proven by a
separate off-chain worker (not the trader's own browser — see "Real
proving, not simulated" in circuits/README.md), submitting an order for
matching now discloses this wallet's actual `spendingKey`, not just an
order-scoped one, to the matcher. That's a narrower privacy loss than it
might sound: on its own, `spendingKey` only lets someone compute a
*nullifierHash* for a commitment whose full preimage (asset/amount/blinding)
they already separately know — it doesn't reveal or let anyone spend this
wallet's other notes. A dedicated order-only key would have closed even
that narrow gap, at the cost of a second circuit parameter; deferred as a
possible future hardening, not because the current exposure is a fund-
safety issue.

- **`placeOrder`** spends a regular note (same Merkle-membership + nullifier
  proof as `pay`) and inserts an `orderCommitment` leaf instead of a regular
  one.
- **`cancelOrder`** spends an `orderCommitment` leaf (same proof shape, just
  against the 6-input hash) and inserts a regular note commitment back —
  the refund, built from the same `spendingKey`'s `ownerKey`.
- **`matchOrders`** spends two `orderCommitment` leaves under the same root
  and inserts the matched proceeds — supporting **partial fills**: the
  matcher proposes `fillA`/`fillB` (private witnesses, how much of each
  order's `amountIn` this match actually consumes), and the circuit checks
  the proposal rather than computing it. Constraints, all private-witness:
  both orders are valid tree members; assets actually cross (`A.assetOut ==
  B.assetIn` and vice versa); neither fill exceeds its own order's real
  `amountIn`; **at least one side is fully consumed** (a real fill, not two
  orders merely resting near each other); and each side's contribution
  meets the *pro-rata* share of the other's minimum-acceptable-amount for
  the portion actually filled (`fillB >= fillA * A.minAmountOut /
  A.amountIn`, floored — exactly the original full-cross minimum check when
  `fill == amountIn`, since `x * m / x == m`). Any side not fully consumed
  gets a residual order re-committed under its own `ownerKey` at a
  pro-rata-scaled `minAmountOut`; a fully-consumed side's residual slot is
  the reserved `ZERO_VALUE` sentinel (see "Merkle tree" below) instead — a
  real order commitment can never equal it, so the sentinel is unambiguous,
  and `ShieldedVault` only inserts a leaf for a slot that isn't it. Matched
  proceeds and residual orders are both built from the trader's own
  `ownerKey`, never the matcher's, so the matcher never needs anything from
  a trader that would let it spend on their behalf.

No matcher role or trusted operator is needed on-chain for any of this —
the proof itself is the entire authorization. The matcher only needs the
two orders' private details (received off-chain) to construct a
`matchOrders` proof; neither trader needs to be online at match time.
`backend/src/dark-engine/fillSizing.ts` decides *what* fill to propose
(pinned to the live FTSOv2 rate, so the realized rate for the filled
portion is the fair rate by construction, not just checked against it after
the fact) and re-verifies its own proposal with the exact same integer
pro-rata math the circuit performs before ever handing it to a prover —
`matchOrders` itself is the actual authority regardless, this just means a
bad proposal fails fast, off-chain, rather than burning a real proving run.
A residual is announced to its trader via `StealthAnnouncer` (scheme id 3,
alongside matched-note delivery on scheme id 2) and — since the matcher
already has every detail needed to keep it tradeable — re-listed on the
matcher's own order book immediately, without waiting on the trader to
notice and resubmit it.

### Arithmetic safety (`matchOrders`'s pro-rata math)

`fillA`, `fillB`, and every order's `amountIn`/`minAmountOut` are range-
checked to 100 bits (`assert_100`, `contract/circuits/noir/lib`) before any
comparison or the pro-rata multiplication (`mul_div_floor`, computed in
`u128`). 100 bits comfortably covers any realistic amount on this project's
three assets, even C2FLR's 18 decimals (2^100 raw units is ~1.27 trillion
whole tokens) — and Noir's own `u128` multiplication is itself
overflow-checked (confirmed empirically, see `lib`'s own
`test_u128_mult_overflow_is_checked_not_wrapping`), so the — for real
orders, unreachable — case of both multiplied values simultaneously near
that ceiling fails to prove rather than silently wrapping into a
wrong/attacker-chosen result. An earlier version of this range check used a
64-bit bound, which turned out too tight for this project's own assets: a
plain 50-token, 18-decimal order (`50 * 10^18` raw units) already exceeds `2^64`. That
wasn't caught by any unit test using small round numbers — only by running
a real end-to-end match through the actual matcher-worker proving pipeline
with realistic amounts, which is why `match_orders`'s own test suite now
includes `test_match_orders_partial_fill_at_realistic_18_decimal_scale`
alongside the small-number cases, and why the backend/matcher-worker crypto
cross-check (`backend/test/match-crypto.test.ts`) uses the same realistic
fixture.

### Known simplification, v1

**`withdraw`'s amount is public** — unavoidably, since it's a plain ERC20
transfer and the contract needs the real value to move real tokens.
`pay`'s amount is private (see above): since `pay` is a straight 1-in-1-out
passthrough (the spent note's amount moves to the output note unchanged,
never summed with anything), hiding it needed only a real output-commitment
check, not the value-conservation/range-proof machinery a multi-input/
multi-output note system (Zcash Sapling/Orchard-style) would need for that.

**`matchOrders` only matches two orders at a time** — partial fills are
real (above), but there's still no N-way matching across more than two
orders in a single proof; a resting residual just becomes an ordinary
order the book can match again later, one pair at a time.

**No on-chain price sanity check on matches.** Order amounts/assets are
private (never public circuit inputs — that's the whole point of hiding an
order), so `ShieldedVault` has nothing to compare against a price feed
without either exposing those amounts or extending the circuit with a
signed price-attestation witness — a materially bigger, separate piece of
work than what's built here. What *is* real: the backend matcher sizes
every fill directly off live FTSOv2 data (`backend/src/dark-engine/
fillSizing.ts`) rather than accepting whatever rate the two order sizes
happen to imply, refusing to propose a fill at all if no valid one clears
both sides' minimums at the fair rate — the same disclosed trust model the
matcher already operates under elsewhere in this document (it already sees
order amounts to build proof inputs at all; this is one more thing it's
trusted to do, not a new category of trust). That's an off-chain policy
backstop, not a cryptographic guarantee the way the fill/pro-rata-minimum
rules above are.

## Merkle tree

- Depth 20 (same choice Tornado Cash uses) — 2^20 ≈ 1,048,576 notes per
  asset pool, plenty for testnet.
- Poseidon2 for internal nodes, same hash family as the commitment/nullifier
  — one hash implementation to trust, in-circuit and on-chain.
- `ShieldedVault` maintains the incremental tree plus the full history of
  every root that's ever been current (not just a bounded recent window) —
  otherwise a proof generated against a root that's since moved on (another
  shield landed first) would wrongly fail.
- `ZERO_VALUE` (`keccak256("umbra-shielded-vault-noir") % Fr`) is the empty
  leaf every unfilled tree position starts as — a domain-separated constant
  no real commitment (note or order) can ever equal, since every real
  commitment is a genuine Poseidon2 output over real field elements. Beyond
  its usual role as the Merkle tree's own empty-slot filler, `matchOrders`
  reuses it as the "no residual" sentinel for a fully-filled side (above) —
  the same unambiguity property applies for the same reason.

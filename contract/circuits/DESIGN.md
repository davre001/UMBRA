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

**Private inputs:** `spendingKey`, `blinding`, `amount`, `assetId`,
`pathElements[20]`, `pathIndices[20]` (Merkle path to the leaf).

**Public inputs:** `root`, `nullifierHash`, `amount`, `assetId`, plus
`recipient` (withdraw) or `outCommitment` (pay).

**Circuit constraints:**
1. `commitment === Poseidon2(assetId, amount, Poseidon2(spendingKey, 0), blinding)`
2. `nullifierHash === Poseidon2(commitment, spendingKey)`
3. Merkle path from `commitment` up to `root` is valid (20 Poseidon2 hashes,
   direction picked per-level by `pathIndices`)
4. `withdraw` only: `recipient` is a public input, so already bound to the
   specific proof by the verification equation itself — no relayer can swap
   it after the fact. `pay` only: the new note's `outCommitment` is taken as
   given (computed client-side the same way a shield commitment is) — the
   circuit doesn't need to open it, just needs to prove the *input* note is
   valid to spend.

`ShieldedVault` then: checks `root` is a known root, checks `nullifierHash`
hasn't been seen before, marks it spent, and either transfers the public
ERC20 out (`withdraw`) or inserts `outCommitment` as a new leaf (`pay`).

## An order (dark pool)

```
order = { secret, nullifier, amountIn, assetIn, assetOut, minAmountOut }
orderCommitment = Poseidon2(nullifier, secret, amountIn, assetIn, assetOut, minAmountOut)   // 6 inputs
```

Poseidon2's sponge IV depends on input count, so a 6-input order commitment
can never collide with a 4-input regular note commitment — both kinds of
leaf share the same Merkle tree without ambiguity about which circuit is
allowed to open which leaf.

Unlike `withdraw`/`pay`, an order's amounts and assets stay **private** —
`placeOrder`/`cancelOrder`/`matchOrders` only expose nullifiers and opaque
commitments as public inputs. Only the matcher, who receives order details
off-chain (encrypted, the same intent-submission flow the rest of the app
already assumes), knows what's actually in an order. This is a materially
stronger privacy property than `withdraw`/`pay` give you, and it's possible
here specifically because nothing about an order needs to become a public
on-chain value the way a `withdraw` payout does. An order's own nullifier
hash is still bound to its specific commitment the same way a regular
note's is (`Poseidon2(orderCommitment, nullifier)`) — orders don't adopt the
`ownerKey` split above, since an order is always created and later spent by
actions the same owner (or the matcher acting on both owners' behalf)
controls, not sent to a third party the way a note can be.

- **`placeOrder`** spends a regular note (same Merkle-membership + nullifier
  proof as `pay`) and inserts an `orderCommitment` leaf instead of a regular
  one.
- **`cancelOrder`** spends an `orderCommitment` leaf (same proof shape, just
  against the 6-input hash) and inserts a regular note commitment back —
  the refund, built from an `ownerKey` the same as `pay`'s output (normally
  the same owner who placed the order, but the circuit doesn't need to
  enforce that).
- **`matchOrders`** spends two `orderCommitment` leaves under the same root
  and inserts two regular note commitments — the matched proceeds, each
  built from that trader's own published `ownerKey` rather than a private
  secret, so the matcher never needs anything from a trader that would let
  it spend on their behalf. The circuit checks, all as private-witness
  constraints: both orders are valid tree members, assets actually cross
  (`A.assetOut == B.assetIn` and vice versa), each side clears the other's
  minimum acceptable amount, and each output note is built from exactly
  what the counterparty put in — an exact bilateral cross, order A's full
  input becomes order B's full output and vice versa.

No matcher role or trusted operator is needed on-chain for any of this —
the proof itself is the entire authorization. The matcher only needs the
two orders' private details (received off-chain) to construct a
`matchOrders` proof; neither trader needs to be online at match time.

### Known simplification, v1

**Amounts are public** for `withdraw`/`pay` (not just source-anonymity).
`withdraw`'s payout amount is unavoidably public (it's a plain ERC20
transfer). Hiding `pay`'s amount too needs the output note to carry a
private amount, a range proof (amount ≥ 0), and an in-circuit value
conservation check (`sum(inputs) == sum(outputs)`), the way Zcash
Sapling/Orchard notes work — a real additional layer of circuit complexity
beyond Merkle-membership + nullifier, deliberately deferred.

**`matchOrders` only supports an exact bilateral cross** — one order's full
input exactly fills the other's, no partial fills, no N-way matching across
more than two orders. A real order book needs partial fills; this proves
the matching-without-a-trusted-role pattern works before building that out.

## Merkle tree

- Depth 20 (same choice Tornado Cash uses) — 2^20 ≈ 1,048,576 notes per
  asset pool, plenty for testnet.
- Poseidon2 for internal nodes, same hash family as the commitment/nullifier
  — one hash implementation to trust, in-circuit and on-chain.
- `ShieldedVault` maintains the incremental tree plus the full history of
  every root that's ever been current (not just a bounded recent window) —
  otherwise a proof generated against a root that's since moved on (another
  shield landed first) would wrongly fail.

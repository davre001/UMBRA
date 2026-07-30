use poseidon::poseidon2::Poseidon2;

// Shared primitives for every action circuit (withdraw, pay, place_order,
// match_orders, cancel_order) — mirrors circuits/DESIGN.md. See
// contracts/lib/ for the matching on-chain Poseidon2 hasher.
pub global LEVELS: u32 = 20;

// Domain-separated zero leaf — keccak256("umbra-shielded-vault-noir") % Fr,
// so nobody can craft a real note whose commitment collides with an empty
// slot's default value.
pub global ZERO_VALUE: Field = 6553590586423608260410254385500912220875115508942847723390064418770335574135;

pub fn hash_left_right(left: Field, right: Field) -> Field {
    Poseidon2::hash([left, right], 2)
}

// Public identifier derived from a wallet's private spending key. Persistent
// per wallet (unlike a note's blinding, which is fresh every time) — this is
// the value a wallet publishes so anyone can build a note commitment that
// only that wallet's spending_key can later spend, without ever handling
// that spending_key itself.
pub fn owner_key(spending_key: Field) -> Field {
    hash_left_right(spending_key, 0)
}

// A spendable note. `blinding` is fresh per note (keeps same-amount,
// same-owner notes unlinkable); `owner_key` is the recipient's published
// public identifier, not their private spending_key — this is what makes a
// note payable to someone else without the sender ever learning anything
// that lets them spend it themselves.
pub fn commitment(asset_id: Field, amount: Field, owner_key: Field, blinding: Field) -> Field {
    Poseidon2::hash([asset_id, amount, owner_key, blinding], 4)
}

// Deterministic per-note nullifier: only whoever holds `spending_key` (the
// preimage of the note's `owner_key`) can compute it, and it's bound to this
// specific note's `commitment` so the same spending_key never produces the
// same nullifier for two different notes.
pub fn nullifier_hash(commitment: Field, spending_key: Field) -> Field {
    hash_left_right(commitment, spending_key)
}

// An order commitment (6 inputs) can never collide with a regular note
// commitment (4 inputs) — Poseidon2's sponge IV is derived from input
// length, so different arities land in disjoint output spaces. That's what
// lets placeOrder/cancelOrder/matchOrders and withdraw/pay share one tree
// without a spendable regular note ever being mistaken for an order, or
// vice versa. Orders are always created and later spent by actions the same
// owner (or, for matchOrders, the matcher acting on both owners' behalf)
// controls — there's no third-party-recipient problem for orders the way
// there is for a spendable note, so this keeps the direct nullifier/secret
// form rather than the owner_key split above.
pub fn order_commitment(
    nullifier: Field,
    secret: Field,
    amount_in: Field,
    asset_in: Field,
    asset_out: Field,
    min_amount_out: Field,
) -> Field {
    Poseidon2::hash([nullifier, secret, amount_in, asset_in, asset_out, min_amount_out], 6)
}

// Range-checks `x` fits in 100 bits — every value that feeds `mul_div_floor`
// below must be checked with this first. 100 bits covers any realistic
// token amount with room to spare (2^100 raw units is ~1.27 trillion
// tokens even at 18 decimals — WFLR's case, the tightest of this project's
// three assets), while `mul_div_floor`'s own u128 multiplication safely
// fails to prove (rather than silently wrapping) in the — for real orders,
// unreachable — case where both of its operands are simultaneously near
// that ceiling: confirmed empirically that Noir's u128 multiply is
// overflow-checked, not wrapping, before relying on it here.
pub fn assert_100(x: Field) {
    x.assert_max_bit_size::<100>();
}

// floor(a * b / c), computed in u128. Callers must range-check a, b, c with
// `assert_100` first — this function only guards against division by zero,
// not against overflow of un-checked inputs (see `assert_100`'s own doc for
// why 100 bits is safe for every real call site here: the multiplied pair
// is always (a filled amount, capped by its own order's amount_in) times
// (that order's own min_amount_out) — both real economic quantities on
// this project's three assets, never independently adversarial-max values).
pub fn mul_div_floor(a: Field, b: Field, c: Field) -> Field {
    let product: u128 = (a as u128) * (b as u128);
    let denominator: u128 = c as u128;
    assert(denominator != 0);
    (product / denominator) as Field
}

// Proves `leaf` is a member of a tree with the given `root`. `path_indices[i]`
// is 0 if `leaf`'s ancestor is the left child at level i, 1 if the right child.
pub fn merkle_root(leaf: Field, path_elements: [Field; LEVELS], path_indices: [bool; LEVELS]) -> Field {
    let mut current = leaf;
    for i in 0..LEVELS {
        let sibling = path_elements[i];
        let is_right = path_indices[i] as Field;
        // is_right == 0 => current is left child; == 1 => current is right child
        let left = current + is_right * (sibling - current);
        let right = sibling + is_right * (current - sibling);
        current = hash_left_right(left, right);
    }
    current
}

#[test]
fn test_owner_key_matches_hash_left_right() {
    let sk = 12345;
    assert(owner_key(sk) == hash_left_right(sk, 0));
}

#[test]
fn test_commitment_then_nullifier_roundtrip() {
    let ok = owner_key(7);
    let c = commitment(0, 100, ok, 999);
    let nf = nullifier_hash(c, 7);
    assert(nf == hash_left_right(c, 7));
    assert(nf == nullifier_hash(commitment(0, 100, ok, 999), 7));
}

#[test]
fn test_different_owners_different_commitments() {
    let ok_a = owner_key(7);
    let ok_b = owner_key(8);
    assert(commitment(0, 100, ok_a, 999) != commitment(0, 100, ok_b, 999));
}

#[test]
fn test_mul_div_floor_exact() {
    assert(mul_div_floor(10, 5, 2) == 25);
}

#[test]
fn test_mul_div_floor_rounds_down() {
    // 7 * 3 / 2 = 10.5 -> floors to 10, never rounds up in the residual's favor.
    assert(mul_div_floor(7, 3, 2) == 10);
}

#[test]
fn test_mul_div_floor_pro_rata_identity() {
    // Filling an order's full amount must reproduce its own min exactly.
    let amount_in = 1000;
    let min_amount_out = 900;
    assert(mul_div_floor(amount_in, min_amount_out, amount_in) == min_amount_out);
}

#[test]
fn test_mul_div_floor_handles_realistic_18_decimal_amounts() {
    // 50 WFLR (18 decimals) filled against a 1000-WFLR order wanting at
    // least 900 FXRP (6 decimals) — the exact magnitude that first exposed
    // assert_64 as too tight for this project's real asset decimals.
    let fill = 50000000000000000000; // 50 * 10^18
    let amount_in = 1000000000000000000000; // 1000 * 10^18
    let min_amount_out = 900000000; // 900 * 10^6
    assert(mul_div_floor(fill, min_amount_out, amount_in) == 45000000); // 45 * 10^6
}

#[test(should_fail)]
fn test_mul_div_floor_rejects_zero_denominator() {
    let _ = mul_div_floor(10, 5, 0);
}

#[test]
fn test_assert_100_accepts_in_range() {
    assert_100(1000);
    assert_100(0);
    assert_100(1000000000000000000000); // 1000 * 10^18, a realistic WFLR amount
}

#[test(should_fail)]
fn test_assert_100_rejects_too_large() {
    // 2^100, one past the max 100-bit value.
    assert_100(1267650600228229401496703205376);
}

#[test(should_fail)]
fn test_u128_mult_overflow_is_checked_not_wrapping() {
    // Confirms the safety assert_100/mul_div_floor's doc comments rely on:
    // Noir's u128 multiply fails a genuine overflow rather than silently
    // wrapping mod 2^128.
    let a: u128 = 340282366920938463463374607431768211455; // u128::MAX
    let b: u128 = 2;
    let c = a * b;
    let _ = c;
}

use umbra_lib::{
    assert_100, commitment, merkle_root, mul_div_floor, nullifier_hash, order_commitment, owner_key, LEVELS, ZERO_VALUE,
};

// Spends two compatible hidden orders and creates the matched output notes,
// supporting partial fills: at least one side is fully consumed, the other
// may have a leftover re-committed as a smaller residual order still on the
// book (see circuits/DESIGN.md). No matcher role or trusted operator needed
// on-chain: this proof IS the authorization. The matcher only needs the two
// orders' private details (received off-chain, same as the existing
// encrypted intent-submission flow) to construct it — neither trader needs
// to be online at match time, and since every output note (matched proceeds
// or residual) is built from that trader's own owner_key(spending_key)
// rather than a secret the matcher chooses, the matcher never needs
// anything from a trader that would let it spend on their behalf.
//
// `fill_a`/`fill_b` are private witnesses the matcher proposes — how much of
// each order's amount_in this particular match actually consumes. The
// circuit only checks the proposal, it doesn't compute it: fill amounts
// can't exceed either order's real amount_in, at least one side must be
// fully consumed (that's what makes this a real fill rather than two orders
// merely resting near each other), and each side's contribution must meet
// the *pro-rata* share of the other side's minimum-acceptable-amount for
// the portion actually filled — exactly the original full-cross minimum
// check when fill equals the whole amount_in (see mul_div_floor's own
// pro-rata-identity test in umbra_lib).
fn main(
    // Public
    root: pub Field,
    nullifier_hash_a: pub Field,
    nullifier_hash_b: pub Field,
    out_commitment_a: pub Field,
    out_commitment_b: pub Field,
    residual_commitment_a: pub Field,
    residual_commitment_b: pub Field,
    // Private — how much of each order this match actually fills
    fill_a: Field,
    fill_b: Field,
    // Private — order A
    a_spending_key: Field,
    a_order_blinding: Field,
    a_amount_in: Field,
    a_asset_in: Field,
    a_asset_out: Field,
    a_min_amount_out: Field,
    a_path_elements: [Field; LEVELS],
    a_path_indices: [bool; LEVELS],
    a_out_blinding: Field,
    a_residual_blinding: Field,
    // Private — order B
    b_spending_key: Field,
    b_order_blinding: Field,
    b_amount_in: Field,
    b_asset_in: Field,
    b_asset_out: Field,
    b_min_amount_out: Field,
    b_path_elements: [Field; LEVELS],
    b_path_indices: [bool; LEVELS],
    b_out_blinding: Field,
    b_residual_blinding: Field,
) {
    let leaf_a = order_commitment(owner_key(a_spending_key), a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out);
    assert(merkle_root(leaf_a, a_path_elements, a_path_indices) == root);
    assert(nullifier_hash(leaf_a, a_spending_key) == nullifier_hash_a);

    let leaf_b = order_commitment(owner_key(b_spending_key), b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out);
    assert(merkle_root(leaf_b, b_path_elements, b_path_indices) == root);
    assert(nullifier_hash(leaf_b, b_spending_key) == nullifier_hash_b);

    // The assets must actually cross: A wants what B is selling, and vice versa.
    assert(a_asset_out == b_asset_in);
    assert(b_asset_out == a_asset_in);

    // Range-check everything that feeds mul_div_floor / u128 comparisons below.
    assert_100(a_amount_in);
    assert_100(a_min_amount_out);
    assert_100(b_amount_in);
    assert_100(b_min_amount_out);
    assert_100(fill_a);
    assert_100(fill_b);

    assert(fill_a as u128 <= a_amount_in as u128);
    assert(fill_b as u128 <= b_amount_in as u128);

    // A real fill: at least one side is fully consumed by this match (two
    // orders that only partially touch each other, with both left resting,
    // isn't a match at all).
    let a_full = fill_a == a_amount_in;
    let b_full = fill_b == b_amount_in;
    assert(a_full | b_full);

    // Each side's contribution must meet the other's pro-rata minimum for
    // the portion actually filled.
    let a_required_min = mul_div_floor(fill_a, a_min_amount_out, a_amount_in);
    assert(fill_b as u128 >= a_required_min as u128);
    let b_required_min = mul_div_floor(fill_b, b_min_amount_out, b_amount_in);
    assert(fill_a as u128 >= b_required_min as u128);

    // A receives fill_b of B's asset; B receives fill_a of A's asset.
    let expected_out_a = commitment(b_asset_in, fill_b, owner_key(a_spending_key), a_out_blinding);
    assert(expected_out_a == out_commitment_a);
    let expected_out_b = commitment(a_asset_in, fill_a, owner_key(b_spending_key), b_out_blinding);
    assert(expected_out_b == out_commitment_b);

    // Any unfilled remainder re-commits as a smaller order at the same
    // implied rate (pro-rata scaled minimum) — still owned by the same
    // trader, still on the book. ZERO_VALUE (the domain-separated empty-leaf
    // constant — see umbra_lib) signals "no residual" when a side fully
    // filled; a real order commitment can never equal it, so the sentinel
    // is unambiguous.
    let a_residual_amount = a_amount_in - fill_a;
    let a_residual_min = mul_div_floor(a_residual_amount, a_min_amount_out, a_amount_in);
    let expected_residual_a = if a_full {
        ZERO_VALUE
    } else {
        order_commitment(owner_key(a_spending_key), a_residual_blinding, a_residual_amount, a_asset_in, a_asset_out, a_residual_min)
    };
    assert(expected_residual_a == residual_commitment_a);

    let b_residual_amount = b_amount_in - fill_b;
    let b_residual_min = mul_div_floor(b_residual_amount, b_min_amount_out, b_amount_in);
    let expected_residual_b = if b_full {
        ZERO_VALUE
    } else {
        order_commitment(owner_key(b_spending_key), b_residual_blinding, b_residual_amount, b_asset_in, b_asset_out, b_residual_min)
    };
    assert(expected_residual_b == residual_commitment_b);
}

// --- test helpers -----------------------------------------------------

fn build_two_leaf_tree(leaf_a: Field, leaf_b: Field) -> (Field, [Field; LEVELS], [bool; LEVELS], [Field; LEVELS], [bool; LEVELS]) {
    let mut zeros: [Field; LEVELS + 1] = [ZERO_VALUE; LEVELS + 1];
    for i in 1..LEVELS + 1 {
        zeros[i] = umbra_lib::hash_left_right(zeros[i - 1], zeros[i - 1]);
    }

    let mut a_path_elements: [Field; LEVELS] = [ZERO_VALUE; LEVELS];
    let a_path_indices: [bool; LEVELS] = [false; LEVELS];
    a_path_elements[0] = leaf_b;
    for i in 1..LEVELS {
        a_path_elements[i] = zeros[i];
    }

    let mut b_path_elements: [Field; LEVELS] = [ZERO_VALUE; LEVELS];
    let mut b_path_indices: [bool; LEVELS] = [false; LEVELS];
    b_path_elements[0] = leaf_a;
    b_path_indices[0] = true;
    for i in 1..LEVELS {
        b_path_elements[i] = zeros[i];
    }

    let root = merkle_root(leaf_a, a_path_elements, a_path_indices);
    (root, a_path_elements, a_path_indices, b_path_elements, b_path_indices)
}

#[test]
fn test_match_orders_full_cross() {
    // Order A: 1000 of asset 0, wants asset 1, min 900 out.
    let a_spending_key = 111;
    let a_order_blinding = 222;
    let a_amount_in = 1000;
    let a_asset_in = 0;
    let a_asset_out = 1;
    let a_min_amount_out = 900;
    let leaf_a = order_commitment(owner_key(a_spending_key), a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out);

    // Order B: 950 of asset 1, wants asset 0, min 800 out — crosses with A, both fully consumed.
    let b_spending_key = 333;
    let b_order_blinding = 444;
    let b_amount_in = 950;
    let b_asset_in = 1;
    let b_asset_out = 0;
    let b_min_amount_out = 800;
    let leaf_b = order_commitment(owner_key(b_spending_key), b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out);

    let (root, a_path_elements, a_path_indices, b_path_elements, b_path_indices) = build_two_leaf_tree(leaf_a, leaf_b);
    assert(merkle_root(leaf_b, b_path_elements, b_path_indices) == root);

    let nh_a = nullifier_hash(leaf_a, a_spending_key);
    let nh_b = nullifier_hash(leaf_b, b_spending_key);

    let a_out_blinding = 555;
    let out_commitment_a = commitment(b_asset_in, b_amount_in, owner_key(a_spending_key), a_out_blinding);
    let b_out_blinding = 666;
    let out_commitment_b = commitment(a_asset_in, a_amount_in, owner_key(b_spending_key), b_out_blinding);

    main(
        root, nh_a, nh_b, out_commitment_a, out_commitment_b, ZERO_VALUE, ZERO_VALUE,
        a_amount_in, b_amount_in,
        a_spending_key, a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out, a_path_elements, a_path_indices, a_out_blinding, 777,
        b_spending_key, b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out, b_path_elements, b_path_indices, b_out_blinding, 888,
    );
}

#[test]
fn test_match_orders_partial_fill() {
    // Order A: 1000 of asset 0, wants asset 1, min 900 out — fully filled.
    let a_spending_key = 111;
    let a_order_blinding = 222;
    let a_amount_in = 1000;
    let a_asset_in = 0;
    let a_asset_out = 1;
    let a_min_amount_out = 900;
    let leaf_a = order_commitment(owner_key(a_spending_key), a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out);

    // Order B: 2000 of asset 1, wants asset 0, min 1500 out — much bigger
    // than A; only 1000 of it is used this match, 1000 rests as a residual.
    let b_spending_key = 333;
    let b_order_blinding = 444;
    let b_amount_in = 2000;
    let b_asset_in = 1;
    let b_asset_out = 0;
    let b_min_amount_out = 1500;
    let leaf_b = order_commitment(owner_key(b_spending_key), b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out);

    let (root, a_path_elements, a_path_indices, b_path_elements, b_path_indices) = build_two_leaf_tree(leaf_a, leaf_b);

    let nh_a = nullifier_hash(leaf_a, a_spending_key);
    let nh_b = nullifier_hash(leaf_b, b_spending_key);

    let fill_a = 1000; // A's full amount
    let fill_b = 1000; // only half of B's amount

    let a_out_blinding = 555;
    let out_commitment_a = commitment(b_asset_in, fill_b, owner_key(a_spending_key), a_out_blinding);
    let b_out_blinding = 666;
    let out_commitment_b = commitment(a_asset_in, fill_a, owner_key(b_spending_key), b_out_blinding);

    // A is fully filled: no residual. B has 1000 left at min_amount_out
    // scaled pro-rata: 1000 * 1500 / 2000 = 750.
    let b_residual_blinding = 999;
    let residual_commitment_b = order_commitment(owner_key(b_spending_key), b_residual_blinding, 1000, b_asset_in, b_asset_out, 750);

    main(
        root, nh_a, nh_b, out_commitment_a, out_commitment_b, ZERO_VALUE, residual_commitment_b,
        fill_a, fill_b,
        a_spending_key, a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out, a_path_elements, a_path_indices, a_out_blinding, 111111,
        b_spending_key, b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out, b_path_elements, b_path_indices, b_out_blinding, b_residual_blinding,
    );
}

#[test]
fn test_match_orders_partial_fill_at_realistic_18_decimal_scale() {
    // A real-world-shaped amount (50 WFLR, 18 decimals) matched against a
    // much bigger FXRP order (6 decimals) — the exact magnitude that first
    // exposed assert_64 as too tight (a mere 50 * 10^18 already exceeds
    // 2^64) before it became assert_100.
    let a_spending_key = 111;
    let a_order_blinding = 222;
    let a_amount_in = 50000000000000000000; // 50 WFLR
    let a_asset_in = 0;
    let a_asset_out = 1;
    let a_min_amount_out = 1;
    let leaf_a = order_commitment(owner_key(a_spending_key), a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out);

    let b_spending_key = 333;
    let b_order_blinding = 444;
    let b_amount_in = 578349; // ~0.578349 FXRP (6 decimals) — 2x what A needs at a live-rate-shaped price
    let b_asset_in = 1;
    let b_asset_out = 0;
    let b_min_amount_out = 1;
    let leaf_b = order_commitment(owner_key(b_spending_key), b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out);

    let (root, a_path_elements, a_path_indices, b_path_elements, b_path_indices) = build_two_leaf_tree(leaf_a, leaf_b);

    let nh_a = nullifier_hash(leaf_a, a_spending_key);
    let nh_b = nullifier_hash(leaf_b, b_spending_key);

    let fill_a = a_amount_in; // A fully fills
    let fill_b = 289175; // about half of B's amount

    let a_out_blinding = 555;
    let out_commitment_a = commitment(b_asset_in, fill_b, owner_key(a_spending_key), a_out_blinding);
    let b_out_blinding = 666;
    let out_commitment_b = commitment(a_asset_in, fill_a, owner_key(b_spending_key), b_out_blinding);

    let b_residual_blinding = 999;
    let b_residual_amount = b_amount_in - fill_b;
    let b_residual_min = mul_div_floor(b_residual_amount, b_min_amount_out, b_amount_in);
    let residual_commitment_b =
        order_commitment(owner_key(b_spending_key), b_residual_blinding, b_residual_amount, b_asset_in, b_asset_out, b_residual_min);

    main(
        root, nh_a, nh_b, out_commitment_a, out_commitment_b, ZERO_VALUE, residual_commitment_b,
        fill_a, fill_b,
        a_spending_key, a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out, a_path_elements, a_path_indices, a_out_blinding, 0,
        b_spending_key, b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out, b_path_elements, b_path_indices, b_out_blinding, b_residual_blinding,
    );
}

#[test(should_fail)]
fn test_match_orders_rejects_incompatible_assets() {
    // Order A wants asset 1; order B is selling asset 2, not asset 1 — must not cross.
    let a_spending_key = 111;
    let a_order_blinding = 222;
    let a_amount_in = 1000;
    let a_asset_in = 0;
    let a_asset_out = 1;
    let a_min_amount_out = 900;
    let leaf_a = order_commitment(owner_key(a_spending_key), a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out);

    let b_spending_key = 333;
    let b_order_blinding = 444;
    let b_amount_in = 950;
    let b_asset_in = 2; // mismatch: A wants asset 1, B is selling asset 2
    let b_asset_out = 0;
    let b_min_amount_out = 800;
    let leaf_b = order_commitment(owner_key(b_spending_key), b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out);

    let (root, a_path_elements, a_path_indices, b_path_elements, b_path_indices) = build_two_leaf_tree(leaf_a, leaf_b);

    let nh_a = nullifier_hash(leaf_a, a_spending_key);
    let nh_b = nullifier_hash(leaf_b, b_spending_key);
    let out_commitment_a = commitment(b_asset_in, b_amount_in, owner_key(555), 666);
    let out_commitment_b = commitment(a_asset_in, a_amount_in, owner_key(777), 888);

    main(
        root, nh_a, nh_b, out_commitment_a, out_commitment_b, ZERO_VALUE, ZERO_VALUE,
        a_amount_in, b_amount_in,
        a_spending_key, a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out, a_path_elements, a_path_indices, 666, 0,
        b_spending_key, b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out, b_path_elements, b_path_indices, 888, 0,
    );
}

#[test(should_fail)]
fn test_match_orders_rejects_fill_exceeding_amount() {
    // fill_a can't exceed order A's real amount_in.
    let a_spending_key = 111;
    let a_order_blinding = 222;
    let a_amount_in = 1000;
    let a_asset_in = 0;
    let a_asset_out = 1;
    let a_min_amount_out = 900;
    let leaf_a = order_commitment(owner_key(a_spending_key), a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out);

    let b_spending_key = 333;
    let b_order_blinding = 444;
    let b_amount_in = 2000;
    let b_asset_in = 1;
    let b_asset_out = 0;
    let b_min_amount_out = 1500;
    let leaf_b = order_commitment(owner_key(b_spending_key), b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out);

    let (root, a_path_elements, a_path_indices, b_path_elements, b_path_indices) = build_two_leaf_tree(leaf_a, leaf_b);

    let nh_a = nullifier_hash(leaf_a, a_spending_key);
    let nh_b = nullifier_hash(leaf_b, b_spending_key);

    let fill_a = 1500; // exceeds a_amount_in (1000)
    let fill_b = 1500;

    let out_commitment_a = commitment(b_asset_in, fill_b, owner_key(a_spending_key), 555);
    let out_commitment_b = commitment(a_asset_in, fill_a, owner_key(b_spending_key), 666);
    let residual_commitment_b = order_commitment(owner_key(b_spending_key), 999, 500, b_asset_in, b_asset_out, 375);

    main(
        root, nh_a, nh_b, out_commitment_a, out_commitment_b, ZERO_VALUE, residual_commitment_b,
        fill_a, fill_b,
        a_spending_key, a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out, a_path_elements, a_path_indices, 555, 0,
        b_spending_key, b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out, b_path_elements, b_path_indices, 666, 999,
    );
}

#[test(should_fail)]
fn test_match_orders_rejects_neither_side_fully_filled() {
    // Both sides partially filled, neither reaching their full amount_in —
    // not a valid match (two orders merely resting near each other).
    let a_spending_key = 111;
    let a_order_blinding = 222;
    let a_amount_in = 1000;
    let a_asset_in = 0;
    let a_asset_out = 1;
    let a_min_amount_out = 900;
    let leaf_a = order_commitment(owner_key(a_spending_key), a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out);

    let b_spending_key = 333;
    let b_order_blinding = 444;
    let b_amount_in = 2000;
    let b_asset_in = 1;
    let b_asset_out = 0;
    let b_min_amount_out = 1500;
    let leaf_b = order_commitment(owner_key(b_spending_key), b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out);

    let (root, a_path_elements, a_path_indices, b_path_elements, b_path_indices) = build_two_leaf_tree(leaf_a, leaf_b);

    let nh_a = nullifier_hash(leaf_a, a_spending_key);
    let nh_b = nullifier_hash(leaf_b, b_spending_key);

    let fill_a = 500; // < a_amount_in
    let fill_b = 1000; // < b_amount_in

    let out_commitment_a = commitment(b_asset_in, fill_b, owner_key(a_spending_key), 555);
    let out_commitment_b = commitment(a_asset_in, fill_a, owner_key(b_spending_key), 666);
    let residual_commitment_a = order_commitment(owner_key(a_spending_key), 777, 500, a_asset_in, a_asset_out, 450);
    let residual_commitment_b = order_commitment(owner_key(b_spending_key), 999, 1000, b_asset_in, b_asset_out, 750);

    main(
        root, nh_a, nh_b, out_commitment_a, out_commitment_b, residual_commitment_a, residual_commitment_b,
        fill_a, fill_b,
        a_spending_key, a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out, a_path_elements, a_path_indices, 555, 777,
        b_spending_key, b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out, b_path_elements, b_path_indices, 666, 999,
    );
}

#[test(should_fail)]
fn test_match_orders_rejects_insufficient_fill_for_pro_rata_minimum() {
    // A is fully filled (1000, pro-rata min = 900) but fill_b is only 500 —
    // below A's minimum for the amount filled.
    let a_spending_key = 111;
    let a_order_blinding = 222;
    let a_amount_in = 1000;
    let a_asset_in = 0;
    let a_asset_out = 1;
    let a_min_amount_out = 900;
    let leaf_a = order_commitment(owner_key(a_spending_key), a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out);

    let b_spending_key = 333;
    let b_order_blinding = 444;
    let b_amount_in = 2000;
    let b_asset_in = 1;
    let b_asset_out = 0;
    let b_min_amount_out = 1500;
    let leaf_b = order_commitment(owner_key(b_spending_key), b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out);

    let (root, a_path_elements, a_path_indices, b_path_elements, b_path_indices) = build_two_leaf_tree(leaf_a, leaf_b);

    let nh_a = nullifier_hash(leaf_a, a_spending_key);
    let nh_b = nullifier_hash(leaf_b, b_spending_key);

    let fill_a = 1000; // full
    let fill_b = 500; // below A's min_amount_out (900) for a full fill

    let out_commitment_a = commitment(b_asset_in, fill_b, owner_key(a_spending_key), 555);
    let out_commitment_b = commitment(a_asset_in, fill_a, owner_key(b_spending_key), 666);
    let residual_commitment_b = order_commitment(owner_key(b_spending_key), 999, 1500, b_asset_in, b_asset_out, 1125);

    main(
        root, nh_a, nh_b, out_commitment_a, out_commitment_b, ZERO_VALUE, residual_commitment_b,
        fill_a, fill_b,
        a_spending_key, a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out, a_path_elements, a_path_indices, 555, 0,
        b_spending_key, b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out, b_path_elements, b_path_indices, 666, 999,
    );
}

#[test(should_fail)]
fn test_match_orders_rejects_fake_residual() {
    // The residual commitment must match the real leftover amount — a
    // prover can't claim a smaller (or arbitrary) residual than what's
    // actually left, which would effectively burn the trader's own funds,
    // nor a larger one, which would mint value that was never in the trade.
    let a_spending_key = 111;
    let a_order_blinding = 222;
    let a_amount_in = 1000;
    let a_asset_in = 0;
    let a_asset_out = 1;
    let a_min_amount_out = 900;
    let leaf_a = order_commitment(owner_key(a_spending_key), a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out);

    let b_spending_key = 333;
    let b_order_blinding = 444;
    let b_amount_in = 2000;
    let b_asset_in = 1;
    let b_asset_out = 0;
    let b_min_amount_out = 1500;
    let leaf_b = order_commitment(owner_key(b_spending_key), b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out);

    let (root, a_path_elements, a_path_indices, b_path_elements, b_path_indices) = build_two_leaf_tree(leaf_a, leaf_b);

    let nh_a = nullifier_hash(leaf_a, a_spending_key);
    let nh_b = nullifier_hash(leaf_b, b_spending_key);

    let fill_a = 1000;
    let fill_b = 1000;

    let out_commitment_a = commitment(b_asset_in, fill_b, owner_key(a_spending_key), 555);
    let out_commitment_b = commitment(a_asset_in, fill_a, owner_key(b_spending_key), 666);
    // Real leftover is 1000 at min 750 — claim a residual of only 400 instead (undercounting B's own funds).
    let fake_residual_b = order_commitment(owner_key(b_spending_key), 999, 400, b_asset_in, b_asset_out, 300);

    main(
        root, nh_a, nh_b, out_commitment_a, out_commitment_b, ZERO_VALUE, fake_residual_b,
        fill_a, fill_b,
        a_spending_key, a_order_blinding, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out, a_path_elements, a_path_indices, 555, 0,
        b_spending_key, b_order_blinding, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out, b_path_elements, b_path_indices, 666, 999,
    );
}

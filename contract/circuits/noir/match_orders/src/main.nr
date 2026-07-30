use umbra_lib::{merkle_root, nullifier_hash, order_commitment, commitment, owner_key, LEVELS, ZERO_VALUE};

// Spends two compatible hidden orders and creates the two matched output
// notes — an exact bilateral cross (order A's full input becomes order B's
// full output and vice versa; partial fills aren't supported, see
// circuits/DESIGN.md). No matcher role or trusted operator needed on-chain:
// this proof IS the authorization. The matcher only needs the two orders'
// private details (received off-chain, same as the existing encrypted
// intent-submission flow) to construct it — neither trader needs to be
// online at match time, and since each output note is built from the
// trader's published owner_key rather than a private secret, the matcher
// never needs anything from a trader that would let it spend on their behalf.
fn main(
    // Public
    root: pub Field,
    nullifier_hash_a: pub Field,
    nullifier_hash_b: pub Field,
    out_commitment_a: pub Field,
    out_commitment_b: pub Field,
    // Private — order A
    a_secret: Field,
    a_nullifier: Field,
    a_amount_in: Field,
    a_asset_in: Field,
    a_asset_out: Field,
    a_min_amount_out: Field,
    a_path_elements: [Field; LEVELS],
    a_path_indices: [bool; LEVELS],
    a_out_owner_key: Field,
    a_out_blinding: Field,
    // Private — order B
    b_secret: Field,
    b_nullifier: Field,
    b_amount_in: Field,
    b_asset_in: Field,
    b_asset_out: Field,
    b_min_amount_out: Field,
    b_path_elements: [Field; LEVELS],
    b_path_indices: [bool; LEVELS],
    b_out_owner_key: Field,
    b_out_blinding: Field,
) {
    let leaf_a = order_commitment(a_nullifier, a_secret, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out);
    assert(merkle_root(leaf_a, a_path_elements, a_path_indices) == root);
    assert(nullifier_hash(leaf_a, a_nullifier) == nullifier_hash_a);

    let leaf_b = order_commitment(b_nullifier, b_secret, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out);
    assert(merkle_root(leaf_b, b_path_elements, b_path_indices) == root);
    assert(nullifier_hash(leaf_b, b_nullifier) == nullifier_hash_b);

    // The assets must actually cross: A wants what B is selling, and vice versa.
    assert(a_asset_out == b_asset_in);
    assert(b_asset_out == a_asset_in);

    // Each side must receive at least their minimum acceptable amount.
    assert(b_amount_in as u128 >= a_min_amount_out as u128);
    assert(a_amount_in as u128 >= b_min_amount_out as u128);

    // A receives exactly what B put in, and B receives exactly what A put in.
    let expected_out_a = commitment(b_asset_in, b_amount_in, a_out_owner_key, a_out_blinding);
    assert(expected_out_a == out_commitment_a);

    let expected_out_b = commitment(a_asset_in, a_amount_in, b_out_owner_key, b_out_blinding);
    assert(expected_out_b == out_commitment_b);
}

#[test]
fn test_match_orders() {
    // Order A: 1000 of asset 0, wants asset 1, min 900 out.
    let a_secret = 111;
    let a_nullifier = 222;
    let a_amount_in = 1000;
    let a_asset_in = 0;
    let a_asset_out = 1;
    let a_min_amount_out = 900;
    let leaf_a = order_commitment(a_nullifier, a_secret, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out);

    // Order B: 950 of asset 1, wants asset 0, min 800 out — crosses with A.
    let b_secret = 333;
    let b_nullifier = 444;
    let b_amount_in = 950;
    let b_asset_in = 1;
    let b_asset_out = 0;
    let b_min_amount_out = 800;
    let leaf_b = order_commitment(b_nullifier, b_secret, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out);

    // Both orders land in the same tree (A at index 0, B at index 1).
    let mut zeros: [Field; LEVELS + 1] = [ZERO_VALUE; LEVELS + 1];
    for i in 1..LEVELS + 1 {
        zeros[i] = umbra_lib::hash_left_right(zeros[i - 1], zeros[i - 1]);
    }

    let mut a_path_elements: [Field; LEVELS] = [ZERO_VALUE; LEVELS];
    let mut a_path_indices: [bool; LEVELS] = [false; LEVELS];
    a_path_elements[0] = leaf_b;
    a_path_indices[0] = false; // A is the left child, B the right, at level 0
    for i in 1..LEVELS {
        a_path_elements[i] = zeros[i];
    }

    let mut b_path_elements: [Field; LEVELS] = [ZERO_VALUE; LEVELS];
    let mut b_path_indices: [bool; LEVELS] = [false; LEVELS];
    b_path_elements[0] = leaf_a;
    b_path_indices[0] = true; // B is the right child at level 0
    for i in 1..LEVELS {
        b_path_elements[i] = zeros[i];
    }

    let root = merkle_root(leaf_a, a_path_elements, a_path_indices);
    assert(merkle_root(leaf_b, b_path_elements, b_path_indices) == root);

    let nh_a = nullifier_hash(leaf_a, a_nullifier);
    let nh_b = nullifier_hash(leaf_b, b_nullifier);

    let a_out_owner_key = owner_key(555);
    let a_out_blinding = 666;
    let out_commitment_a = commitment(b_asset_in, b_amount_in, a_out_owner_key, a_out_blinding);

    let b_out_owner_key = owner_key(777);
    let b_out_blinding = 888;
    let out_commitment_b = commitment(a_asset_in, a_amount_in, b_out_owner_key, b_out_blinding);

    main(
        root, nh_a, nh_b, out_commitment_a, out_commitment_b,
        a_secret, a_nullifier, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out, a_path_elements, a_path_indices, a_out_owner_key, a_out_blinding,
        b_secret, b_nullifier, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out, b_path_elements, b_path_indices, b_out_owner_key, b_out_blinding,
    );
}

#[test(should_fail)]
fn test_match_orders_rejects_incompatible_assets() {
    // Order A wants asset 1; order B is selling asset 2, not asset 1 — must not cross.
    let a_secret = 111;
    let a_nullifier = 222;
    let a_amount_in = 1000;
    let a_asset_in = 0;
    let a_asset_out = 1;
    let a_min_amount_out = 900;
    let leaf_a = order_commitment(a_nullifier, a_secret, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out);

    let b_secret = 333;
    let b_nullifier = 444;
    let b_amount_in = 950;
    let b_asset_in = 2; // mismatch: A wants asset 1, B is selling asset 2
    let b_asset_out = 0;
    let b_min_amount_out = 800;
    let leaf_b = order_commitment(b_nullifier, b_secret, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out);

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

    let nh_a = nullifier_hash(leaf_a, a_nullifier);
    let nh_b = nullifier_hash(leaf_b, b_nullifier);
    let out_commitment_a = commitment(b_asset_in, b_amount_in, owner_key(555), 666);
    let out_commitment_b = commitment(a_asset_in, a_amount_in, owner_key(777), 888);

    main(
        root, nh_a, nh_b, out_commitment_a, out_commitment_b,
        a_secret, a_nullifier, a_amount_in, a_asset_in, a_asset_out, a_min_amount_out, a_path_elements, a_path_indices, owner_key(555), 666,
        b_secret, b_nullifier, b_amount_in, b_asset_in, b_asset_out, b_min_amount_out, b_path_elements, b_path_indices, owner_key(777), 888,
    );
}

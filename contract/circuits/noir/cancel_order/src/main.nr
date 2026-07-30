use umbra_lib::{commitment, merkle_root, nullifier_hash, order_commitment, owner_key, LEVELS, ZERO_VALUE};

// Spends a hidden order commitment and returns a regular, spendable note for
// the original amount/asset — cancelling a dark-pool order. Same private-
// order-details treatment as place_order: nothing about the cancelled
// order's size or assets is revealed, only the nullifier and the new
// refund note's opaque commitment. See circuits/DESIGN.md.
//
// The order is owned by `owner_key(spending_key)` — the same persistent key
// as any note this wallet owns (see place_order) — so cancelling reuses the
// same spending_key rather than a separate per-order secret.
fn main(
    // Public
    root: pub Field,
    nullifier_hash_pub: pub Field,
    refund_commitment_pub: pub Field,
    // Private — the order being cancelled
    spending_key: Field,
    order_blinding: Field,
    amount_in: Field,
    asset_in: Field,
    asset_out: Field,
    min_amount_out: Field,
    path_elements: [Field; LEVELS],
    path_indices: [bool; LEVELS],
    // Private — the refund note
    refund_blinding: Field,
) {
    let leaf = order_commitment(owner_key(spending_key), order_blinding, amount_in, asset_in, asset_out, min_amount_out);
    assert(merkle_root(leaf, path_elements, path_indices) == root);
    assert(nullifier_hash(leaf, spending_key) == nullifier_hash_pub);

    let refund = commitment(asset_in, amount_in, owner_key(spending_key), refund_blinding);
    assert(refund == refund_commitment_pub);
}

#[test]
fn test_cancel_order() {
    let spending_key = 111;
    let order_blinding = 555;
    let amount_in = 1000;
    let asset_in = 0;
    let asset_out = 1;
    let min_amount_out = 900;
    let leaf = order_commitment(owner_key(spending_key), order_blinding, amount_in, asset_in, asset_out, min_amount_out);

    let mut path_elements: [Field; LEVELS] = [ZERO_VALUE; LEVELS];
    let path_indices: [bool; LEVELS] = [false; LEVELS];
    let mut zero = ZERO_VALUE;
    for i in 0..LEVELS {
        path_elements[i] = zero;
        zero = umbra_lib::hash_left_right(zero, zero);
    }

    let root = merkle_root(leaf, path_elements, path_indices);
    let nh = nullifier_hash(leaf, spending_key);

    let refund_blinding = 888;
    let refund_commitment_pub = commitment(asset_in, amount_in, owner_key(spending_key), refund_blinding);

    main(
        root, nh, refund_commitment_pub, spending_key, order_blinding, amount_in, asset_in, asset_out,
        min_amount_out, path_elements, path_indices, refund_blinding,
    );
}

#[test(should_fail)]
fn test_cancel_order_rejects_refund_to_different_owner() {
    // The refund must go back to the same spending_key that owned the order
    // — a prover can't cancel someone else's order into a note for a
    // different owner than the circuit itself derives.
    let spending_key = 111;
    let order_blinding = 555;
    let amount_in = 1000;
    let asset_in = 0;
    let asset_out = 1;
    let min_amount_out = 900;
    let leaf = order_commitment(owner_key(spending_key), order_blinding, amount_in, asset_in, asset_out, min_amount_out);

    let mut path_elements: [Field; LEVELS] = [ZERO_VALUE; LEVELS];
    let path_indices: [bool; LEVELS] = [false; LEVELS];
    let mut zero = ZERO_VALUE;
    for i in 0..LEVELS {
        path_elements[i] = zero;
        zero = umbra_lib::hash_left_right(zero, zero);
    }

    let root = merkle_root(leaf, path_elements, path_indices);
    let nh = nullifier_hash(leaf, spending_key);

    let wrong_refund = commitment(asset_in, amount_in, owner_key(999), 888);

    main(
        root, nh, wrong_refund, spending_key, order_blinding, amount_in, asset_in, asset_out,
        min_amount_out, path_elements, path_indices, 888,
    );
}

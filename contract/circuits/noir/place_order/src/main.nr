use umbra_lib::{commitment, merkle_root, nullifier_hash, order_commitment, owner_key, LEVELS, ZERO_VALUE};

// Spends a regular shielded note and creates a hidden order commitment in
// its place — placing a dark-pool order. Unlike withdraw/pay, the order's
// size, assets, and slippage bound stay private: only `order_commitment`
// (opaque) and the spent note's nullifier are public. Only the matcher, who
// receives the order details off-chain (encrypted, same as the existing
// intent-submission flow), knows what's actually in the order. See
// circuits/DESIGN.md.
fn main(
    // Public
    root: pub Field,
    nullifier_hash_pub: pub Field,
    order_commitment_pub: pub Field,
    // Private — the note being spent
    spending_key: Field,
    blinding: Field,
    amount_in: Field,
    asset_in: Field,
    path_elements: [Field; LEVELS],
    path_indices: [bool; LEVELS],
    // Private — the order being placed
    order_secret: Field,
    order_nullifier: Field,
    asset_out: Field,
    min_amount_out: Field,
) {
    let leaf = commitment(asset_in, amount_in, owner_key(spending_key), blinding);
    assert(merkle_root(leaf, path_elements, path_indices) == root);
    assert(nullifier_hash(leaf, spending_key) == nullifier_hash_pub);

    let out = order_commitment(order_nullifier, order_secret, amount_in, asset_in, asset_out, min_amount_out);
    assert(out == order_commitment_pub);
}

#[test]
fn test_place_order() {
    let spending_key = 111;
    let blinding = 999;
    let amount_in = 1000;
    let asset_in = 0;
    let leaf = commitment(asset_in, amount_in, owner_key(spending_key), blinding);

    let mut path_elements: [Field; LEVELS] = [ZERO_VALUE; LEVELS];
    let path_indices: [bool; LEVELS] = [false; LEVELS];
    let mut zero = ZERO_VALUE;
    for i in 0..LEVELS {
        path_elements[i] = zero;
        zero = umbra_lib::hash_left_right(zero, zero);
    }

    let root = merkle_root(leaf, path_elements, path_indices);
    let nh = nullifier_hash(leaf, spending_key);

    let order_secret = 555;
    let order_nullifier = 666;
    let asset_out = 1;
    let min_amount_out = 900;
    let order_commitment_pub =
        order_commitment(order_nullifier, order_secret, amount_in, asset_in, asset_out, min_amount_out);

    main(
        root, nh, order_commitment_pub, spending_key, blinding, amount_in, asset_in, path_elements, path_indices,
        order_secret, order_nullifier, asset_out, min_amount_out,
    );
}

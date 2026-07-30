use umbra_lib::{commitment, merkle_root, nullifier_hash, owner_key, LEVELS, ZERO_VALUE};

// Same statement as withdraw — proves ownership of a shielded note without
// revealing which deposit it came from — but instead of paying out a public
// ERC20 transfer, authorizes crediting a new hidden output commitment
// (computed client-side the same way a shield commitment is; this circuit
// doesn't need to open it, only prove the *input* note is validly spent).
// The output commitment is built from the recipient's published owner_key,
// not their private spending_key — the sender never needs anything that
// would let them spend it themselves. See circuits/DESIGN.md.
//
// Known v1 simplification: amount/asset_id are still public here, same as
// withdraw. Hiding the amount too needs value-conservation + range-proof
// constraints over private amounts — deferred, see DESIGN.md.
fn main(
    // Public
    root: pub Field,
    nullifier_hash_pub: pub Field,
    amount: pub Field,
    asset_id: pub Field,
    out_commitment: pub Field,
    // Private — the note being spent
    spending_key: Field,
    blinding: Field,
    path_elements: [Field; LEVELS],
    path_indices: [bool; LEVELS],
) {
    let leaf = commitment(asset_id, amount, owner_key(spending_key), blinding);
    assert(merkle_root(leaf, path_elements, path_indices) == root);
    assert(nullifier_hash(leaf, spending_key) == nullifier_hash_pub);

    // Same reasoning as withdraw.nr's `recipient`: already bound to the
    // proof as a public input, this just satisfies the "input must be used" check.
    assert(out_commitment == out_commitment);
}

#[test]
fn test_pay() {
    let spending_key = 777;
    let blinding = 888;
    let amount = 250;
    let asset_id = 1;
    let leaf = commitment(asset_id, amount, owner_key(spending_key), blinding);

    let mut path_elements: [Field; LEVELS] = [ZERO_VALUE; LEVELS];
    let path_indices: [bool; LEVELS] = [false; LEVELS];
    let mut zero = ZERO_VALUE;
    for i in 0..LEVELS {
        path_elements[i] = zero;
        zero = umbra_lib::hash_left_right(zero, zero);
    }

    let root = merkle_root(leaf, path_elements, path_indices);
    let nh = nullifier_hash(leaf, spending_key);

    // Output note credited to a different owner (the recipient) — the
    // sender only needs their published owner_key, computed here from a
    // spending_key standing in for "some key the sender doesn't hold".
    let recipient_owner_key = owner_key(24680);
    let out_blinding = 13579;
    let out_commitment = commitment(asset_id, amount, recipient_owner_key, out_blinding);

    main(root, nh, amount, asset_id, out_commitment, spending_key, blinding, path_elements, path_indices);
}

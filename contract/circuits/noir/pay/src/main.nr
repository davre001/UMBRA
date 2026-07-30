use umbra_lib::{commitment, merkle_root, nullifier_hash, owner_key, LEVELS, ZERO_VALUE};

// Same statement as withdraw — proves ownership of a shielded note without
// revealing which deposit it came from — but instead of paying out a public
// ERC20 transfer, authorizes crediting a new hidden output commitment built
// from the recipient's published owner_key, not their private spending_key
// (the sender never needs anything that would let them spend it themselves).
// See circuits/DESIGN.md.
//
// The output commitment is genuinely recomputed and checked here — unlike
// withdraw's public `recipient` (which the *contract* binds to the real
// ERC20 transfer using the same calldata, making an in-circuit check
// redundant there), pay's `out_commitment` has no such external anchor: the
// contract just inserts whatever value the proof accepts. Skipping this
// check would let anyone pair a proof for spending a trivial real note with
// an arbitrary, uncapped out_commitment.
//
// `amount` is private: pay is a straight 1-in-1-out passthrough (the same
// amount moves from the input note to the output note, unchanged), so
// there's no sum to range-check — hiding it doesn't need the value-
// conservation/range-proof machinery a multi-note join-split would.
fn main(
    // Public
    root: pub Field,
    nullifier_hash_pub: pub Field,
    asset_id: pub Field,
    out_commitment: pub Field,
    // Private — the note being spent
    spending_key: Field,
    blinding: Field,
    amount: Field,
    path_elements: [Field; LEVELS],
    path_indices: [bool; LEVELS],
    // Private — the output note
    out_owner_key: Field,
    out_blinding: Field,
) {
    let leaf = commitment(asset_id, amount, owner_key(spending_key), blinding);
    assert(merkle_root(leaf, path_elements, path_indices) == root);
    assert(nullifier_hash(leaf, spending_key) == nullifier_hash_pub);

    let expected_out = commitment(asset_id, amount, out_owner_key, out_blinding);
    assert(expected_out == out_commitment);
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
    let out_owner_key = owner_key(24680);
    let out_blinding = 13579;
    let out_commitment = commitment(asset_id, amount, out_owner_key, out_blinding);

    main(
        root, nh, asset_id, out_commitment, spending_key, blinding, amount, path_elements, path_indices,
        out_owner_key, out_blinding,
    );
}

#[test(should_fail)]
fn test_pay_rejects_mismatched_output_value() {
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

    // Attacker-supplied out_commitment encodes a much larger amount than the
    // real input note — must be rejected, not accepted by a tautological check.
    let out_owner_key = owner_key(99);
    let out_blinding = 1;
    let forged_out_commitment = commitment(asset_id, 999_999_999, out_owner_key, out_blinding);

    main(
        root, nh, asset_id, forged_out_commitment, spending_key, blinding, amount, path_elements, path_indices,
        out_owner_key, out_blinding,
    );
}

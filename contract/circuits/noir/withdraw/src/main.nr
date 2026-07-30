use umbra_lib::{commitment, merkle_root, nullifier_hash, owner_key, LEVELS, ZERO_VALUE};

// Proves ownership of a shielded note without revealing which deposit it
// came from, and authorizes paying its amount out publicly to `recipient`.
// See circuits/DESIGN.md. Amount/asset are public on purpose — the payout
// is a plain ERC20 transfer, so those can't be hidden either way. What's
// hidden is which prior `shield` this withdrawal traces back to.
fn main(
    // Public
    root: pub Field,
    nullifier_hash_pub: pub Field,
    amount: pub Field,
    asset_id: pub Field,
    recipient: pub Field,
    // Private — the note being spent
    spending_key: Field,
    blinding: Field,
    path_elements: [Field; LEVELS],
    path_indices: [bool; LEVELS],
) {
    let leaf = commitment(asset_id, amount, owner_key(spending_key), blinding);
    assert(merkle_root(leaf, path_elements, path_indices) == root);
    assert(nullifier_hash(leaf, spending_key) == nullifier_hash_pub);

    // `recipient` is a public input already bound to the proof by the
    // verification equation itself — unlike the ECDSA-signature version this
    // replaces, no extra in-circuit constraint is needed to stop a relayer
    // swapping it post-proof. Referencing it here just satisfies Noir's
    // "every input must be used" check.
    assert(recipient == recipient);
}

#[test]
fn test_withdraw() {
    let spending_key = 111;
    let blinding = 999;
    let amount = 1000;
    let asset_id = 0;
    let leaf = commitment(asset_id, amount, owner_key(spending_key), blinding);

    // Build a depth-LEVELS path where `leaf` is always the left child and
    // every sibling is the empty-subtree zero at that level — the simplest
    // tree containing exactly one real note.
    let mut path_elements: [Field; LEVELS] = [ZERO_VALUE; LEVELS];
    let path_indices: [bool; LEVELS] = [false; LEVELS];
    let mut zero = ZERO_VALUE;
    for i in 0..LEVELS {
        path_elements[i] = zero;
        zero = umbra_lib::hash_left_right(zero, zero);
    }

    let root = merkle_root(leaf, path_elements, path_indices);
    let nh = nullifier_hash(leaf, spending_key);
    let recipient = 0x70997970c51812dc3a010c7d01b50e0d17dc79c8;

    main(root, nh, amount, asset_id, recipient, spending_key, blinding, path_elements, path_indices);
}

use poseidon::poseidon2::Poseidon2;
use sha256::digest;
use umbra_lib::hash_left_right;

// Bitcoin block headers are 80 raw bytes, little-endian throughout: version
// (4), prev_block_hash (32), merkle_root (32), timestamp (4), bits (4),
// nonce (4). Byte offsets/endianness confirmed empirically against a real
// signet header fetched from mempool.space (see main.nr's fixture test),
// not assumed from spec alone.
pub global HEADER_SIZE: u32 = 80;

pub fn parse_prev_hash(header: [u8; HEADER_SIZE]) -> [u8; 32] {
    let mut out: [u8; 32] = [0; 32];
    for i in 0..32 {
        out[i] = header[4 + i];
    }
    out
}

pub fn parse_merkle_root(header: [u8; HEADER_SIZE]) -> [u8; 32] {
    let mut out: [u8; 32] = [0; 32];
    for i in 0..32 {
        out[i] = header[36 + i];
    }
    out
}

// sha256d(header) = sha256(sha256(header)). Returned in Bitcoin's native
// byte order (same order the raw header bytes and `sha256::digest` output
// already use) — index 0 is the *least* significant byte of the hash
// interpreted as a 256-bit integer. This is deliberately NOT the
// byte-reversed form block explorers display; reversing is a display-only
// convention, and mixing the two forms up is exactly the kind of
// off-by-nothing-but-still-wrong bug the header format invites.
pub fn double_sha256(header: [u8; HEADER_SIZE]) -> [u8; 32] {
    digest(digest(header))
}

// Splits a 32-byte little-endian value into (low128, high128) u128 limbs,
// so a 256-bit comparison can be done with two ordinary u128 comparisons
// instead of relying on Field arithmetic — BN254's field is ~254 bits, too
// narrow to safely hold an arbitrary 256-bit Bitcoin target/hash without
// silent wraparound. Same "range-check before comparing" discipline
// umbra_lib's assert_100/mul_div_floor already use for u128 math.
fn bytes32_to_u128_limbs(bytes: [u8; 32]) -> (u128, u128) {
    let mut lo: u128 = 0;
    let mut lo_mul: u128 = 1;
    for i in 0..16 {
        lo = lo + (bytes[i] as u128) * lo_mul;
        // Skip the last iteration's multiply: 256^16 == 2^128 overflows
        // u128 even though the value is never used (Noir's u128 multiply
        // is overflow-checked, not wrapping — confirmed the hard way here;
        // see umbra_lib's own test_u128_mult_overflow_is_checked_not_wrapping).
        if i != 15 {
            lo_mul = lo_mul * 256;
        }
    }
    let mut hi: u128 = 0;
    let mut hi_mul: u128 = 1;
    for i in 16..32 {
        hi = hi + (bytes[i] as u128) * hi_mul;
        if i != 31 {
            hi_mul = hi_mul * 256;
        }
    }
    (lo, hi)
}

// Commits a raw 32-byte hash (checkpoint or any other opaque 256-bit
// value) to a single Field via umbra_lib's own Poseidon2 pairing —
// `Poseidon2::hash([lo, hi], 2)`, the same primitive every other
// commitment in this project already uses. Exists because a `pub [u8; 32]`
// circuit parameter does NOT become one `bytes32` public input on the
// Solidity side — Barretenberg's public-inputs array is one Field slot per
// `pub` value, so 32 individual `pub u8`s would expand into 32 separate
// slots, not the single `bytes32` a Solidity struct field expects.
// Confirmed this the hard way after Phase 2 first shipped `pub [u8; 32]`
// directly — fixed before Phase 5 could lock a mismatched contract
// interface around it. `ShieldedVault.checkpoints[sourceChainId]` must
// store this same commitment (computed off-chain via the identical
// lo/hi-limb + Poseidon2 formula), not the raw checkpoint hash itself.
pub fn checkpoint_commitment(hash: [u8; 32]) -> Field {
    let (lo, hi) = bytes32_to_u128_limbs(hash);
    hash_left_right(lo as Field, hi as Field)
}

fn hash_less_than_target(hash: [u8; 32], target: [u8; 32]) -> bool {
    let (hash_lo, hash_hi) = bytes32_to_u128_limbs(hash);
    let (target_lo, target_hi) = bytes32_to_u128_limbs(target);
    (hash_hi < target_hi) | ((hash_hi == target_hi) & (hash_lo < target_lo))
}

// Decodes Bitcoin's compact difficulty representation (`bits`, the 4 header
// bytes at offset 72) into a full 256-bit target, little-endian byte order
// (same convention as `double_sha256`'s output, so the two are directly
// comparable). `bits` little-endian byte layout: byte 0..3 = mantissa (low
// to high), byte 3 = exponent. target = mantissa * 256^(exponent - 3).
fn target_from_bits(header: [u8; HEADER_SIZE]) -> [u8; 32] {
    let mantissa0 = header[72];
    let mantissa1 = header[73];
    let mantissa2 = header[74];
    let exponent = header[75] as u32;

    // Bounds confirmed against real signet data (exponent 0x1d = 29 there);
    // guards against underflow in `exponent - 3` below and against a
    // claimed exponent too large for a 32-byte target to represent.
    assert(exponent >= 3);
    assert(exponent <= 32);

    let byte0_pos = exponent - 3;
    let byte1_pos = exponent - 2;
    let byte2_pos = exponent - 1;

    let mut target: [u8; 32] = [0; 32];
    for i in 0..32 {
        let pos = i as u32;
        let is_byte0 = pos == byte0_pos;
        let is_byte1 = pos == byte1_pos;
        let is_byte2 = pos == byte2_pos;
        target[i] = if is_byte0 {
            mantissa0
        } else if is_byte1 {
            mantissa1
        } else if is_byte2 {
            mantissa2
        } else {
            0
        };
    }
    target
}

// Proves `header` is a validly-mined 80-byte Bitcoin header: its sha256d
// hash, read as a little-endian 256-bit integer, is below the target its
// own `bits` field implies. Returns the hash (native byte order) so callers
// (Phase 2's chain-linking) can check `next_header`'s `prev_hash` against
// it without recomputing. Does NOT verify signet's additional federation
// signer check — see BTC_DEPOSIT_DESIGN.md's "Known simplifications".
pub fn verify_pow(header: [u8; HEADER_SIZE]) -> [u8; 32] {
    let hash = double_sha256(header);
    let target = target_from_bits(header);
    assert(hash_less_than_target(hash, target));
    hash
}

// Fixed header-chain length — a v1 scope decision, not a per-proof
// parameter. See BTC_DEPOSIT_DESIGN.md's "Fixed header-chain length, K = 6".
pub global K: u32 = 6;

// Proves `headers` is a chain of K validly-mined headers correctly linking
// forward from `checkpoint_hash` (`headers[0].prev_hash == checkpoint_hash`,
// then each subsequent header's `prev_hash` equals the previous header's
// own sha256d hash), each independently passing `verify_pow`. Returns the
// chain tip's hash — Phase 4 will use `headers[K-1]`'s parsed merkle_root
// (not this return value) for Merkle-inclusion, but the tip hash is kept
// available for whatever ends up needing it.
//
// `checkpoint_hash` must be in the same native (non-display-reversed) byte
// order `double_sha256`/`parse_prev_hash` already use throughout this
// module — whatever registers a checkpoint on `ShieldedVault` (Phase 5)
// must supply that same native-order value, not the byte-reversed hex a
// block explorer displays. Getting this backwards would silently make
// every real header chain fail to link against its own checkpoint.
pub fn verify_header_chain(checkpoint_hash: [u8; 32], headers: [[u8; HEADER_SIZE]; K]) -> [u8; 32] {
    let mut prev_hash = checkpoint_hash;
    let mut tip_hash = checkpoint_hash;
    for i in 0..K {
        let header = headers[i];
        assert(parse_prev_hash(header) == prev_hash);
        let hash = verify_pow(header);
        prev_hash = hash;
        tip_hash = hash;
    }
    tip_hash
}

// --- Phase 4: deposit transaction template, txid, Merkle inclusion -------
//
// A fixed, exactly-sized transaction shape — NOT arbitrary Bitcoin
// transaction parsing (that needs dynamic-length varint/script parsing, a
// much bigger scope). One input (any SegWit spend — the input's own
// witness/script type is irrelevant, since txid only ever depends on the
// *non-witness* serialization, which is identically shaped for P2WPKH,
// P2WSH, or P2TR inputs as long as scriptSig is empty, true for all of
// them) and exactly two outputs:
//   output 0: OP_RETURN carrying the depositor's EVM recipient address —
//             a 32-byte push, left-zero-padded (same "address as bytes32"
//             convention Ethereum ABI encoding already uses), only the
//             last 20 bytes are the actual address
//   output 1: P2WPKH payment to UMBRA's fixed vault address
//
// Why the OP_RETURN is load-bearing, not decorative: proof construction
// happens on-chain (Flare), separately from and after the real Bitcoin
// payment. If the mint recipient were only a private witness supplied at
// proving time, ANYONE who observed the confirmed Bitcoin payment could
// submit the deposit proof first with their OWN recipient address,
// stealing the mint. Binding the recipient directly into the Bitcoin
// transaction itself — which only the real depositor could have signed —
// closes that gap: who gets minted WrappedBTC is fixed by the on-chain
// payment, not by whoever happens to submit the proof. Whoever submits it
// is otherwise irrelevant (the backend does, automatically, once proven —
// see backend/src/btc-deposit/minter.ts), same as anyone being able to
// relay a signed Ethereum meta-transaction. See BTC_DEPOSIT_DESIGN.md for
// the fuller "proof construction is permissionless" reasoning (written for
// the original private-note design, still applies to who-can-submit here).
pub global TX_SIZE: u32 = 125;
pub global MAX_MERKLE_DEPTH: u32 = 20;

// UMBRA's real deployed signet vault P2WPKH pubkey hash — address
// tb1qrmq4qvr3qmcn5s6yxlcr7y80cry0530n99g2mm, generated for this
// deployment (2026-08-10). Must match backend/.env's BTC_VAULT_PUBKEY_HASH
// and the custodian key in BTC_CUSTODIAN_WIF exactly, or deposits/
// withdrawals disagree about which address is the vault. See
// BTC_DEPOSIT_DESIGN.md.
pub global VAULT_PUBKEY_HASH: [u8; 20] = [
    0x1e, 0xc1, 0x50, 0x30, 0x71, 0x06, 0xf1, 0x3a, 0x43, 0x44,
    0x37, 0xf0, 0x3f, 0x10, 0xef, 0xc0, 0xc8, 0xfa, 0x45, 0xf3,
];

// Interprets `bytes` as a big-endian unsigned integer and returns it as a
// Field. Used for the 20-byte EVM recipient address extracted from the
// OP_RETURN. Big-endian by UMBRA's own choice (not a Bitcoin protocol
// requirement, since the OP_RETURN payload is UMBRA's own data) to match
// this stack's existing bytes32/uint256 convention, deliberately distinct
// from Bitcoin's own little-endian header fields — see main.nr's fixture
// for the exact encoding a depositor's wallet must produce.
fn bytes_be_to_field<let N: u32>(bytes: [u8; N]) -> Field {
    let mut acc: Field = 0;
    for i in 0..N {
        acc = acc * 256 + (bytes[i] as Field);
    }
    acc
}

// Interprets `bytes` as a little-endian unsigned integer and returns it as
// a Field. Used for the payment `amount` (Bitcoin's native tx `value`
// field is little-endian, unavoidably — it's a protocol field, not
// UMBRA's own data). Satoshi amounts (max ~2.1e15) fit comfortably in a
// Field with no overflow risk, unlike the 256-bit hash/target comparisons
// above, which is why this doesn't need the u128-limb-splitting those did.
fn bytes_le_to_field<let N: u32>(bytes: [u8; N]) -> Field {
    let mut acc: Field = 0;
    let mut mul: Field = 1;
    for i in 0..N {
        acc = acc + (bytes[i] as Field) * mul;
        mul = mul * 256;
    }
    acc
}

// Validates `tx` matches the fixed deposit template exactly (1 input, empty
// scriptSig, exactly 2 outputs shaped as described above, output 1 paying
// UMBRA's vault address) and extracts (recipient, amount, txid). A `tx`
// that doesn't match the template — wrong input/output count, wrong
// OP_RETURN push length/padding, wrong payment destination — fails one of
// these asserts rather than silently misparsing.
pub fn parse_deposit_tx(tx: [u8; TX_SIZE]) -> (Field, Field, [u8; 32]) {
    assert(tx[4] == 1); // exactly one input
    assert(tx[41] == 0); // empty scriptSig (every SegWit spend has this)
    assert(tx[46] == 2); // exactly two outputs

    // output 0: OP_RETURN, value must be 0, 34-byte script (OP_RETURN + push32 + left-zero-padded 20-byte recipient)
    for i in 0..8 {
        assert(tx[47 + i] == 0);
    }
    assert(tx[55] == 0x22);
    assert(tx[56] == 0x6a);
    assert(tx[57] == 0x20);
    // Bytes 58..70 (12 bytes) must be zero — the left-padding half of the
    // "address as bytes32" encoding. Enforced, not just assumed: a
    // depositor who left this non-zero couldn't be minting to a real
    // 20-byte address anyway, so rejecting here is strictly more correct
    // than silently truncating to the low 20 bytes.
    for i in 0..12 {
        assert(tx[58 + i] == 0);
    }
    let mut recipient_bytes: [u8; 20] = [0; 20];
    for i in 0..20 {
        recipient_bytes[i] = tx[70 + i];
    }
    let recipient = bytes_be_to_field(recipient_bytes);

    // output 1: P2WPKH payment to the vault address
    let mut amount_bytes: [u8; 8] = [0; 8];
    for i in 0..8 {
        amount_bytes[i] = tx[90 + i];
    }
    let amount = bytes_le_to_field(amount_bytes);
    assert(tx[98] == 0x16);
    assert(tx[99] == 0x00);
    assert(tx[100] == 0x14);
    for i in 0..20 {
        assert(tx[101 + i] == VAULT_PUBKEY_HASH[i]);
    }

    let txid = digest(digest(tx));
    (recipient, amount, txid)
}

fn sha256d_concat(left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
    let mut buf: [u8; 64] = [0; 64];
    for i in 0..32 {
        buf[i] = left[i];
    }
    for i in 0..32 {
        buf[32 + i] = right[i];
    }
    digest(digest(buf))
}

// Proves `txid` is included under `merkle_root` via a bounded-depth Merkle
// path. Real Bitcoin blocks have a variable tx count, so the real path
// depth varies per block — MAX_MERKLE_DEPTH is a fixed circuit-level
// ceiling (20, matching this project's own note-tree depth elsewhere;
// 2^20 comfortably exceeds any real block's tx count). `actual_depth` is a
// private witness, not independently re-derived from anything — an
// incorrect `actual_depth` (or tampered path_elements/path_indices) simply
// produces a wrong root and fails the final equality check, so it doesn't
// need its own correctness proof, only the `<= MAX_MERKLE_DEPTH` bound.
// Levels at or past `actual_depth` are no-ops (current hash passes through
// unchanged) rather than being combined into the hash.
pub fn verify_tx_inclusion(
    txid: [u8; 32],
    merkle_root: [u8; 32],
    path_elements: [[u8; 32]; MAX_MERKLE_DEPTH],
    path_indices: [bool; MAX_MERKLE_DEPTH],
    actual_depth: u32,
) {
    assert(actual_depth <= MAX_MERKLE_DEPTH);
    let mut current = txid;
    for i in 0..MAX_MERKLE_DEPTH {
        let active = (i as u32) < actual_depth;
        let sibling = path_elements[i];
        let combined = if path_indices[i] {
            sha256d_concat(sibling, current)
        } else {
            sha256d_concat(current, sibling)
        };
        current = if active { combined } else { current };
    }
    assert(current == merkle_root);
}

// --- Phase 5: note binding -------------------------------------------

// Asset identifier for BTC in ShieldedVault's assetId numbering scheme
// (this project's existing assets use 0/1/2 for C2FLR/FXRP/USDT0). Not
// used by this circuit's own math anymore (see main.nr — the deposit
// proof now mints a real, publicly-held WrappedBTC ERC20 directly, not a
// private note commitment keyed by assetId), but kept here as the shared
// source of truth other files reference (backend, contract deploy
// scripts, frontend) so they can't silently drift out of agreement with
// each other about which numeric id means BTC.
//
// Deployment note: unlike the earlier private-note design, this assetId
// SHOULD now be registered via ShieldedVault.setAsset(id, wrappedBtcToken,
// allowed=true) — WrappedBTC is real, redeemable ERC20 collateral (see
// WrappedBTC.sol), minted 1:1 against the custodian's real signet BTC
// holdings by the automatic minter (backend/src/btc-deposit/minter.ts)
// once a deposit proof verifies, and burned on withdrawal/redemption. The
// old "never allowlist this" constraint applied only to the prior
// no-real-collateral design and no longer holds.
pub global BTC_ASSET_ID: Field = 999;

// Domain-separation tag so BTC-sourced nullifiers can never collide with a
// future Ethereum deposit circuit's own nullifiers, even though both would
// share ShieldedVault's single isSpentNullifier mapping (same mapping
// every other circuit's nullifiers already share — see DESIGN.md). Derived
// as keccak256("BTC_SIGNET") % Fr (BN254 scalar field), the same
// domain-separation convention umbra_lib's own ZERO_VALUE uses. Computed
// via ethers.js: keccak256(toUtf8Bytes("BTC_SIGNET")) =
// 0x5b2b79af9a2064a41a53f83acc6c8cfad3b61646800a01767d6c78d07fd323d9
pub global BTC_SIGNET_CHAIN_TAG: Field =
    0x2ac72b3cb8eec47a6203b2844aeb349dab822dfe065090e5398a833c8fd323d8;

// Nullifier for a BTC-sourced note: Poseidon2 over the txid's two 128-bit
// limbs plus the chain tag (3-arity) — a different arity from the regular
// 2-input note nullifier_hash(commitment, spendingKey) `umbra_lib` uses
// (via hash_left_right) and from checkpoint_commitment's own 2-input hash
// above, so it lands in a disjoint Poseidon2 output space by construction
// (same arity-based separation umbra_lib documents for order_commitment's
// 6-input vs. regular 4-input commitment) — on top of the explicit
// BTC_SIGNET_CHAIN_TAG input, not relying on arity alone.
pub fn deposit_nullifier(txid: [u8; 32]) -> Field {
    let (lo, hi) = bytes32_to_u128_limbs(txid);
    Poseidon2::hash([lo as Field, hi as Field, BTC_SIGNET_CHAIN_TAG], 3)
}

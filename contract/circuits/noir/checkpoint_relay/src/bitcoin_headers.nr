use sha256::digest;
use umbra_lib::hash_left_right;

// Header/PoW/checkpoint primitives for `checkpoint_relay`. Deliberately a
// byte-for-byte duplicate of `btc_deposit/src/bitcoin.nr`'s equivalent
// functions (HEADER_SIZE, K, parse_prev_hash, double_sha256,
// bytes32_to_u128_limbs, hash_less_than_target, target_from_bits,
// verify_pow, checkpoint_commitment, verify_header_chain), not a shared-lib
// import — moving them into `umbra_lib` would touch `btc_deposit`'s module
// structure and risk shifting its already-deployed verifier's VK even with
// identical logic, forcing a redeploy + re-trust of a circuit that's
// otherwise untouched by this change. If `btc_deposit` and this circuit's
// header logic ever needs to change, keep both copies in sync by hand. See
// docs/BTC_DEPOSIT_DESIGN.md and this package's own README for the fuller
// reasoning.

pub global HEADER_SIZE: u32 = 80;

pub fn parse_prev_hash(header: [u8; HEADER_SIZE]) -> [u8; 32] {
    let mut out: [u8; 32] = [0; 32];
    for i in 0..32 {
        out[i] = header[4 + i];
    }
    out
}

pub fn double_sha256(header: [u8; HEADER_SIZE]) -> [u8; 32] {
    digest(digest(header))
}

fn bytes32_to_u128_limbs(bytes: [u8; 32]) -> (u128, u128) {
    let mut lo: u128 = 0;
    let mut lo_mul: u128 = 1;
    for i in 0..16 {
        lo = lo + (bytes[i] as u128) * lo_mul;
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

// Commits a raw 32-byte hash to a single Field via the same Poseidon2
// pairing btc_deposit's checkpoint_commitment uses — MUST stay bit-for-bit
// identical to that function, since ShieldedVault.checkpoints[sourceChainId]
// is written by both btc_deposit-adjacent tooling (executeInitializeCheckpoint)
// and this circuit's own extendCheckpoint proofs, and both have to agree on
// what a "commitment" means for the same on-chain value.
pub fn checkpoint_commitment(hash: [u8; 32]) -> Field {
    let (lo, hi) = bytes32_to_u128_limbs(hash);
    hash_left_right(lo as Field, hi as Field)
}

fn hash_less_than_target(hash: [u8; 32], target: [u8; 32]) -> bool {
    let (hash_lo, hash_hi) = bytes32_to_u128_limbs(hash);
    let (target_lo, target_hi) = bytes32_to_u128_limbs(target);
    (hash_hi < target_hi) | ((hash_hi == target_hi) & (hash_lo < target_lo))
}

fn target_from_bits(header: [u8; HEADER_SIZE]) -> [u8; 32] {
    let mantissa0 = header[72];
    let mantissa1 = header[73];
    let mantissa2 = header[74];
    let exponent = header[75] as u32;

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

pub fn verify_pow(header: [u8; HEADER_SIZE]) -> [u8; 32] {
    let hash = double_sha256(header);
    let target = target_from_bits(header);
    assert(hash_less_than_target(hash, target));
    hash
}

// Fixed header-chain length — must match btc_deposit::bitcoin::K exactly:
// extendCheckpoint's proof and depositExternal's proof both advance/consume
// the same checkpoint state by this many headers per step. See
// BTC_DEPOSIT_DESIGN.md's "Fixed header-chain length, K = 6".
pub global K: u32 = 6;

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

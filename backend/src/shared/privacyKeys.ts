import { bytesToBigInt, bytesToHex, concatBytes, hexToBytes, keccak256, toBytes, type Hex } from "viem";
import { publicKeyToAddress } from "viem/utils";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes as cipherRandomBytes } from "@noble/ciphers/utils.js";

/**
 * Same scheme as frontend/src/lib/noteWallet/privacyKeys.ts — kept as a
 * byte-for-byte duplicate here rather than a shared package, matching this
 * codebase's existing convention (see stealthAnnouncerAbi.ts, already
 * duplicated in both trees). Only `encryptAnnouncement`/
 * `encryptAndTagAnnouncement` are actually used backend-side (submitter.ts
 * only ever encrypts *to* a trader, never decrypts) — `decryptAnnouncement`/
 * `matchStealthTag` stay here anyway so this file is a genuine mirror, and
 * so backend/test/privacy-crypto.test.ts can verify round-trip behavior
 * without needing a cross-package import into frontend/.
 *
 * ECIES-over-secp256k1 for `StealthAnnouncer` announcements, plus a stealth
 * one-time address derived from the same ephemeral key. This closes two
 * gaps in the original scheme (see circuits/DESIGN.md and
 * docs/concepts/stealth-addresses): `announce()`'s `metadata` used to be
 * plain ABI-encoded bytes anyone could decode, and `pay()`'s `stealthAddress`
 * used to be the recipient's real wallet address.
 */

const SECP256K1_ORDER = secp256k1.Point.Fn.ORDER;
const HKDF_INFO = toBytes("umbra-stealth-announcer-v1");
const NONCE_LENGTH = 24; // xchacha20poly1305
const TAG_LENGTH = 16; // poly1305

function scalarFromHash(hash: Uint8Array): bigint {
  let scalar = bytesToBigInt(hash) % SECP256K1_ORDER;
  if (scalar === BigInt(0)) scalar = BigInt(1); // astronomically unlikely, keeps the scalar a valid private key
  return scalar;
}

function bigIntTo32Bytes(value: bigint): Uint8Array {
  return hexToBytes(("0x" + value.toString(16).padStart(64, "0")) as Hex);
}

export interface PrivacyKeyPair {
  privateKey: Uint8Array;
  /** Compressed secp256k1 public key, 33 bytes — what gets published on PrivacyKeyRegistry. */
  publicKey: Uint8Array;
}

/** A wallet's persistent privacy keypair — derived once from the same signature spendingKey uses, reused across every announcement it makes or receives. */
export function derivePrivacyKeyPair(walletSignature: Hex): PrivacyKeyPair {
  const hash = keccak256(toBytes(`umbra-note:${walletSignature}:privacy-key:`));
  const privateKey = bigIntTo32Bytes(scalarFromHash(hexToBytes(hash)));
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  return { privateKey, publicKey };
}

/** HKDF over the raw ECDH output — never use a shared secret directly as a symmetric key. */
function symmetricKey(ecdhSharedSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, ecdhSharedSecret, undefined, HKDF_INFO, 32);
}

/** Same tweak scalar drives both the encryption key and the stealth-tag offset, from the same ECDH shared secret — one ECDH per announcement, two uses. */
function tweakScalar(ecdhSharedSecret: Uint8Array): bigint {
  return scalarFromHash(sha256(ecdhSharedSecret));
}

export interface EncryptedAnnouncement {
  ephemeralPubKey: Hex;
  metadata: Hex;
}

function encryptWithEphemeralKey(
  recipientPubKey: Uint8Array,
  plaintext: Uint8Array,
  ephemeralPrivateKey: Uint8Array
): EncryptedAnnouncement {
  const ephemeralPubKey = secp256k1.getPublicKey(ephemeralPrivateKey, true);
  const sharedSecret = secp256k1.getSharedSecret(ephemeralPrivateKey, recipientPubKey);
  const key = symmetricKey(sharedSecret);
  const nonce = cipherRandomBytes(NONCE_LENGTH);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
  return {
    ephemeralPubKey: bytesToHex(ephemeralPubKey),
    metadata: bytesToHex(concatBytes([nonce, ciphertext])),
  };
}

/** Encrypts `plaintext` (the ABI-encoded note/order metadata) to `recipientPubKey` (compressed secp256k1, 33 bytes) — a fresh ephemeral key per call, so the same plaintext never produces the same ciphertext twice. Used for `announceResidualOrder` (stealthAddress stays the trader's own real address — already public via their own placeOrder tx, nothing to hide). */
export function encryptAnnouncement(recipientPubKey: Uint8Array, plaintext: Uint8Array): EncryptedAnnouncement {
  return encryptWithEphemeralKey(recipientPubKey, plaintext, secp256k1.utils.randomSecretKey());
}

/** Attempts to decrypt an announcement's metadata with the given privacy private key. Returns null if it's the legacy plaintext format, addressed to someone else, or tampered — never throws. */
export function decryptAnnouncement(myPrivateKey: Uint8Array, ephemeralPubKey: Hex, metadata: Hex): Uint8Array | null {
  try {
    const ephemeralPubKeyBytes = hexToBytes(ephemeralPubKey);
    if (ephemeralPubKeyBytes.length === 0) return null; // legacy plaintext announcement, nothing to decrypt
    const metadataBytes = hexToBytes(metadata);
    if (metadataBytes.length < NONCE_LENGTH + TAG_LENGTH) return null;
    const nonce = metadataBytes.slice(0, NONCE_LENGTH);
    const ciphertext = metadataBytes.slice(NONCE_LENGTH);
    const sharedSecret = secp256k1.getSharedSecret(myPrivateKey, ephemeralPubKeyBytes);
    const key = symmetricKey(sharedSecret);
    return xchacha20poly1305(key, nonce).decrypt(ciphertext);
  } catch {
    return null;
  }
}

function stealthPoint(basePubKey: Uint8Array, ecdhPrivateKey: Uint8Array, ecdhPubKey: Uint8Array) {
  const sharedSecret = secp256k1.getSharedSecret(ecdhPrivateKey, ecdhPubKey);
  const tweak = tweakScalar(sharedSecret);
  return secp256k1.Point.fromBytes(basePubKey).add(secp256k1.Point.BASE.multiply(tweak));
}

function deriveStealthTag(recipientPubKey: Uint8Array, ephemeralPrivateKey: Uint8Array): `0x${string}` {
  const tagPoint = stealthPoint(recipientPubKey, ephemeralPrivateKey, recipientPubKey);
  return publicKeyToAddress(bytesToHex(tagPoint.toBytes(false)));
}

export interface EncryptedAndTaggedAnnouncement extends EncryptedAnnouncement {
  /** One-time address for `pay()`'s `stealthAddress` param — unlinkable to the recipient's real address without their private key. */
  stealthAddress: `0x${string}`;
}

/**
 * `announceMatchedNote`'s version of `encryptAnnouncement`: also derives a
 * one-time `stealthAddress` tag from the *same* ephemeral key used to
 * encrypt, so the trader's real address never has to appear in the
 * `Announcement` event for a matched-proceeds delivery — same reasoning as
 * `pay()`'s frontend use of this function.
 */
export function encryptAndTagAnnouncement(recipientPubKey: Uint8Array, plaintext: Uint8Array): EncryptedAndTaggedAnnouncement {
  const ephemeralPrivateKey = secp256k1.utils.randomSecretKey();
  const encrypted = encryptWithEphemeralKey(recipientPubKey, plaintext, ephemeralPrivateKey);
  const stealthAddress = deriveStealthTag(recipientPubKey, ephemeralPrivateKey);
  return { ...encrypted, stealthAddress };
}

/** Recomputes the same tag from a private key + an announcement's `ephemeralPubKey`, to check whether that announcement is addressed to that key's owner. */
export function matchStealthTag(myPrivateKey: Uint8Array, ephemeralPubKey: Hex, candidateAddress: `0x${string}`): boolean {
  try {
    const ephemeralPubKeyBytes = hexToBytes(ephemeralPubKey);
    if (ephemeralPubKeyBytes.length === 0) return false;
    const myPubKey = secp256k1.getPublicKey(myPrivateKey, true);
    const tagPoint = stealthPoint(myPubKey, myPrivateKey, ephemeralPubKeyBytes);
    const derivedAddress = publicKeyToAddress(bytesToHex(tagPoint.toBytes(false)));
    return derivedAddress.toLowerCase() === candidateAddress.toLowerCase();
  } catch {
    return false;
  }
}

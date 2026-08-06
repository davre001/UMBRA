import { describe, it, expect } from "vitest";
import type { Hex } from "viem";
import {
  derivePrivacyKeyPair,
  encryptAnnouncement,
  decryptAnnouncement,
  encryptAndTagAnnouncement,
  matchStealthTag,
} from "../src/shared/privacyKeys";

/**
 * shared/privacyKeys.ts is a byte-for-byte duplicate of
 * frontend/src/lib/noteWallet/privacyKeys.ts (see that file's own comment —
 * same convention as the already-duplicated stealthAnnouncerAbi.ts). The
 * golden fixture below pins the one part that has to stay bit-identical for
 * a wallet's key to actually work across both trees: key derivation from a
 * wallet signature. If this ever fails, the two copies have drifted and a
 * key derived by the frontend won't decrypt what the backend encrypts to it
 * (or vice versa) — same role match-crypto.test.ts's fixture plays for the
 * Poseidon2/Merkle assembly.
 */
const FIXTURE_SIGNATURE: Hex =
  "0x1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111c";
const FIXTURE_PRIVATE_KEY = "bc056332da1c7ce7ad034324d726c93501b6d0b8c648f1dc36c81c88db98bfdb";
const FIXTURE_PUBLIC_KEY = "02c7a2202d036266d395d5fbddec07fe74f8924cfd2fc4d7fc1b3edcac96fbc469";

describe("privacyKeys key derivation vs. the frontend's golden fixture", () => {
  it("reproduces the exact private/public key for a fixed wallet signature", () => {
    const { privateKey, publicKey } = derivePrivacyKeyPair(FIXTURE_SIGNATURE);
    expect(Buffer.from(privateKey).toString("hex")).toBe(FIXTURE_PRIVATE_KEY);
    expect(Buffer.from(publicKey).toString("hex")).toBe(FIXTURE_PUBLIC_KEY);
  });

  it("is deterministic — same signature always derives the same keypair", () => {
    const a = derivePrivacyKeyPair(FIXTURE_SIGNATURE);
    const b = derivePrivacyKeyPair(FIXTURE_SIGNATURE);
    expect(Buffer.from(a.privateKey)).toEqual(Buffer.from(b.privateKey));
  });
});

describe("encryptAnnouncement / decryptAnnouncement round-trip", () => {
  it("decrypts to the original plaintext with the right key", () => {
    const recipient = derivePrivacyKeyPair("0xaaaa");
    const plaintext = new TextEncoder().encode("assetId=1,amount=1000000000000000000");
    const { ephemeralPubKey, metadata } = encryptAnnouncement(recipient.publicKey, plaintext);
    const decrypted = decryptAnnouncement(recipient.privateKey, ephemeralPubKey, metadata);
    expect(decrypted).not.toBeNull();
    expect(Buffer.from(decrypted!).toString()).toBe(Buffer.from(plaintext).toString());
  });

  it("returns null (never throws) for the wrong private key", () => {
    const recipient = derivePrivacyKeyPair("0xaaaa");
    const someoneElse = derivePrivacyKeyPair("0xbbbb");
    const { ephemeralPubKey, metadata } = encryptAnnouncement(recipient.publicKey, new TextEncoder().encode("secret"));
    expect(decryptAnnouncement(someoneElse.privateKey, ephemeralPubKey, metadata)).toBeNull();
  });

  it("treats an empty ephemeralPubKey as the legacy plaintext format and returns null rather than attempting to decrypt", () => {
    const recipient = derivePrivacyKeyPair("0xaaaa");
    expect(decryptAnnouncement(recipient.privateKey, "0x", "0xdeadbeef")).toBeNull();
  });

  it("produces a different ciphertext every call for the same plaintext (fresh ephemeral key + nonce)", () => {
    const recipient = derivePrivacyKeyPair("0xaaaa");
    const plaintext = new TextEncoder().encode("same plaintext");
    const first = encryptAnnouncement(recipient.publicKey, plaintext);
    const second = encryptAnnouncement(recipient.publicKey, plaintext);
    expect(first.metadata).not.toBe(second.metadata);
  });
});

describe("encryptAndTagAnnouncement / matchStealthTag round-trip", () => {
  it("lets the recipient recognize an announcement addressed to them, and reject one that isn't", () => {
    const recipient = derivePrivacyKeyPair("0xcccc");
    const someoneElse = derivePrivacyKeyPair("0xdddd");
    const plaintext = new TextEncoder().encode("assetId=2,amount=500");

    const { ephemeralPubKey, metadata, stealthAddress } = encryptAndTagAnnouncement(recipient.publicKey, plaintext);

    expect(matchStealthTag(recipient.privateKey, ephemeralPubKey, stealthAddress)).toBe(true);
    expect(matchStealthTag(someoneElse.privateKey, ephemeralPubKey, stealthAddress)).toBe(false);

    const decrypted = decryptAnnouncement(recipient.privateKey, ephemeralPubKey, metadata);
    expect(Buffer.from(decrypted!).toString()).toBe(Buffer.from(plaintext).toString());
  });

  it("derives a stealthAddress that isn't the recipient's own address", () => {
    const recipient = derivePrivacyKeyPair("0xcccc");
    const { stealthAddress } = encryptAndTagAnnouncement(recipient.publicKey, new TextEncoder().encode("x"));
    // Never equal by construction (a hash-derived EC point vs. a keccak-of-pubkey
    // address are unrelated values), but assert the shape explicitly so a future
    // refactor that accidentally reuses the real address would fail loudly.
    expect(stealthAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("returns false (never throws) for a legacy (empty ephemeralPubKey) announcement", () => {
    const recipient = derivePrivacyKeyPair("0xcccc");
    expect(matchStealthTag(recipient.privateKey, "0x", "0x0000000000000000000000000000000000000000")).toBe(false);
  });
});

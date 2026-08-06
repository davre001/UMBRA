// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title PrivacyKeyRegistry
/// @notice Lets a wallet publish a compressed secp256k1 public key used for
///         two things: ECIES-encrypting `StealthAnnouncer` metadata (so
///         amount/asset/blinding are no longer readable in the clear), and
///         deriving a one-time stealth `stealthAddress` tag for `pay()`
///         announcements (so the recipient's real address doesn't have to
///         appear in the event). See circuits/DESIGN.md and
///         docs/concepts/stealth-addresses for the full scheme. Standalone
///         and additive, same pattern as `OwnerKeyRegistry` — a lookup
///         helper, nothing else reads it on-chain, and it doesn't replace or
///         touch `OwnerKeyRegistry`'s own already-deployed mapping.
/// @dev Deliberately no removal/rotation function, same reasoning as
///      `OwnerKeyRegistry`: a wallet can always overwrite its own entry with
///      a fresh key, and this contract never needs to reason about which one
///      is "current" beyond the latest value on file.
contract PrivacyKeyRegistry {
    /// @notice A compressed secp256k1 public key is always exactly 33 bytes
    ///         (1 parity byte + 32-byte x-coordinate) — see privacyKeys.ts's
    ///         `derivePrivacyKeyPair`/`secp256k1.getPublicKey(priv, true)` on
    ///         both the frontend and backend.
    uint256 public constant KEY_LENGTH = 33;

    mapping(address => bytes) public privacyKeyOf;

    event PrivacyKeyRegistered(address indexed account, bytes privacyKey);

    error InvalidKeyLength(uint256 length);

    /// @notice Publish (or overwrite) the caller's compressed secp256k1 public key (33 bytes).
    function register(bytes calldata privacyKey) external {
        if (privacyKey.length != KEY_LENGTH) revert InvalidKeyLength(privacyKey.length);
        privacyKeyOf[msg.sender] = privacyKey;
        emit PrivacyKeyRegistered(msg.sender, privacyKey);
    }

    /// @notice Whether `account` has published a privacy key yet.
    function isRegistered(address account) external view returns (bool) {
        return privacyKeyOf[account].length != 0;
    }
}

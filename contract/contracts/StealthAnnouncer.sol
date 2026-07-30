// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title StealthAnnouncer
/// @notice On-chain announcement log for stealth payments, following the
///         EIP-5564 `Announcement` event shape. Recipients watch this log
///         (or a backend indexer that watches it) to discover incoming
///         private payments addressed to one of their stealth addresses.
/// @dev Anyone may announce — the vault's `pay`/`withdraw` flow calls this
///      after crediting a stealth destination so the payment is discoverable
///      off-chain without revealing the sender/recipient link on its own.
contract StealthAnnouncer {
    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    /// @param schemeId identifies the stealth-address derivation scheme (1 = secp256k1, per EIP-5564)
    /// @param stealthAddress the one-time destination address funds were sent to
    /// @param ephemeralPubKey the ephemeral public key the recipient needs to compute the shared secret
    /// @param metadata scheme-specific data (e.g. a view-tag byte, asset id, encrypted memo)
    function announce(
        uint256 schemeId,
        address stealthAddress,
        bytes calldata ephemeralPubKey,
        bytes calldata metadata
    ) external {
        emit Announcement(schemeId, stealthAddress, msg.sender, ephemeralPubKey, metadata);
    }
}

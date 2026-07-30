// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title OwnerKeyRegistry
/// @notice Lets a wallet publish the public `ownerKey` derived from its
///         shielded-note spending key (`ownerKey = Poseidon2(spendingKey, 0)`,
///         see circuits/DESIGN.md), so senders can look it up before building
///         a `pay`/`matchOrders` output note for that wallet. Standalone —
///         ShieldedVault doesn't read this contract; it's a lookup helper for
///         callers building proof inputs off-chain.
/// @dev Deliberately no removal/rotation function: a wallet can always
///      overwrite its own entry with a fresh ownerKey, but this contract
///      never needs to reason about which one is "current" beyond the
///      latest value on file.
contract OwnerKeyRegistry {
    mapping(address => uint256) public ownerKeyOf;

    event OwnerKeyRegistered(address indexed account, uint256 ownerKey);

    /// @notice Publish (or overwrite) the caller's ownerKey.
    function register(uint256 ownerKey) external {
        ownerKeyOf[msg.sender] = ownerKey;
        emit OwnerKeyRegistered(msg.sender, ownerKey);
    }

    /// @notice Whether `account` has published an ownerKey yet.
    function isRegistered(address account) external view returns (bool) {
        return ownerKeyOf[account] != 0;
    }
}

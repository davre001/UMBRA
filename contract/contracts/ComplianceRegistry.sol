// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ComplianceRegistry
/// @notice Records sanction-screen results for addresses so ShieldedVault can gate
///         private payments on them.
/// @dev INTERIM TRUST MODEL: a real deployment verifies the screen result via an FDC
///      attestation proof before recording it. That verification isn't wired up yet,
///      so recording is instead restricted to ATTESTER_ROLE holders (the off-chain
///      compliance service). Swap `screen()`'s access check for FDC proof
///      verification once available — `isScreened` for downstream callers stays the
///      same.
contract ComplianceRegistry is AccessControl {
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");

    struct ScreenResult {
        bool clear;
        uint64 screenedAt;
    }

    mapping(address => ScreenResult) public screenResults;

    event Screened(address indexed account, bool clear, uint64 screenedAt);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Record a sanction-screen result for `account`.
    function screen(address account, bool clear) external onlyRole(ATTESTER_ROLE) {
        screenResults[account] = ScreenResult({clear: clear, screenedAt: uint64(block.timestamp)});
        emit Screened(account, clear, uint64(block.timestamp));
    }

    /// @notice Whether `account` currently has a clear sanction screen on file.
    function isScreened(address account) external view returns (bool) {
        return screenResults[account].clear;
    }
}

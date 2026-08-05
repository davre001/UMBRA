// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IShieldedVaultWithdraw {
    function withdraw(
        bytes calldata proof,
        uint256 root,
        uint256 nullifierHash,
        uint256 amount,
        uint256 assetId,
        address recipient
    ) external;
}

/// @title BatchWithdrawer
/// @notice Permissionless call-forwarder so one wallet signature can cover N
///         independent ShieldedVault.withdraw() calls instead of N separate
///         signatures — built for "Unshield All", which otherwise needs one
///         approval per note. Holds no funds and needs no privilege of its
///         own: each withdraw() is itself proof-authorized (see
///         ShieldedVault's own NatSpec — the proof is the authorization, not
///         who calls it) and pays `recipient` directly, this contract only
///         loops the calls. Takes `vault` as a call-time parameter rather
///         than a constructor argument specifically so it never needs
///         redeploying if ShieldedVault ever does.
/// @dev    Each call is individually try/catch'd so one bad item (an
///         already-spent nullifier, a stale root, ...) doesn't revert the
///         whole batch — matches the frontend's existing partial-success
///         UX for "Unshield All" (see shield/page.tsx's succeeded/failed
///         counts), now backed by a real on-chain guarantee of the same
///         behavior instead of it only being true because each note was
///         already a separate transaction.
contract BatchWithdrawer {
    event WithdrawAttempted(address indexed vault, uint256 indexed index, uint256 nullifierHash, bool success);

    struct WithdrawCall {
        bytes proof;
        uint256 root;
        uint256 nullifierHash;
        uint256 amount;
        uint256 assetId;
        address recipient;
    }

    function batchWithdraw(address vault, WithdrawCall[] calldata calls) external {
        for (uint256 i = 0; i < calls.length; i++) {
            WithdrawCall calldata c = calls[i];
            try IShieldedVaultWithdraw(vault).withdraw(c.proof, c.root, c.nullifierHash, c.amount, c.assetId, c.recipient) {
                emit WithdrawAttempted(vault, i, c.nullifierHash, true);
            } catch {
                emit WithdrawAttempted(vault, i, c.nullifierHash, false);
            }
        }
    }
}

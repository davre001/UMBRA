// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleTreeWithHistory} from "./lib/MerkleTreeWithHistory.sol";

interface IComplianceRegistry {
    function isScreened(address account) external view returns (bool);
}

/// @notice The `verify(bytes,bytes32[])` shape bb's `write_solidity_verifier`
///         generates for UltraHonk (evm target) — see verifiers/*.sol,
///         generated from circuits/noir/*.
interface IUltraHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @title ShieldedVault
/// @notice Locks allowlisted assets (ERC20s, plus native C2FLR for
///         `nativeAssetId`) and holds shielded balances as hidden notes in a
///         commitment Merkle tree — not a public account=>balance
///         mapping. See circuits/DESIGN.md for the full note/commitment/
///         nullifier scheme. Every state-changing action (withdraw, pay,
///         placeOrder, cancelOrder, matchOrders) is gated by a real
///         UltraHonk (Noir/Barretenberg) proof, verified on-chain — no
///         trusted role for any of them, including matching. Proving uses
///         Aztec's public "Ignition" ceremony SRS, universal and reused
///         across circuits rather than a bespoke per-circuit trusted setup.
/// @dev No ERC-2771/meta-tx machinery here on purpose: spending a note is
///      authorized by the ZK proof itself (knowledge of its secret/nullifier),
///      not by who calls the function — every action here is already
///      relayable by anyone, including a fee-paying relayer, with no
///      forwarder needed. `shield` is the one exception: a plain deposit
///      from the real depositor (ERC20 `transferFrom`, or for `nativeAssetId`,
///      the transaction's own native value).
contract ShieldedVault is AccessControl, ReentrancyGuard, MerkleTreeWithHistory {
    using SafeERC20 for IERC20;

    IUltraHonkVerifier public immutable withdrawVerifier;
    IUltraHonkVerifier public immutable payVerifier;
    IUltraHonkVerifier public immutable placeOrderVerifier;
    IUltraHonkVerifier public immutable cancelOrderVerifier;
    IUltraHonkVerifier public immutable matchOrdersVerifier;

    /// @notice The one assetId (if any) that `shield`/`withdraw` treat as
    ///         native C2FLR instead of a plain ERC20 — set once at deploy
    ///         time, matching this project's existing "assetId 0 = the FLR
    ///         leg" convention. The vault just holds native value directly
    ///         for this asset (any contract can — no wrapping needed): no
    ///         wrapped-token contract is involved anywhere for it, so
    ///         `assetToken[nativeAssetId]` is left unset (address(0)) and is
    ///         never read for this assetId.
    uint256 public immutable nativeAssetId;

    mapping(uint256 => address) public assetToken;
    mapping(uint256 => bool) public isAllowedAsset;
    mapping(uint256 => bool) public isSpentNullifier;

    IComplianceRegistry public complianceRegistry;

    event AssetAllowlisted(uint256 indexed assetId, address indexed token, bool allowed);
    event ComplianceRegistryUpdated(address indexed registry);
    event Shielded(uint256 indexed assetId, uint256 commitment, uint32 leafIndex, uint256 newRoot);
    event Withdrawn(uint256 indexed assetId, uint256 indexed nullifierHash, address indexed recipient, uint256 amount);
    event Paid(uint256 indexed assetId, uint256 indexed nullifierHash, uint256 outCommitment, uint32 leafIndex, uint256 newRoot);
    event OrderPlaced(uint256 indexed nullifierHash, uint256 orderCommitment, uint32 leafIndex, uint256 newRoot);
    event OrderCancelled(uint256 indexed nullifierHash, uint256 refundCommitment, uint32 leafIndex, uint256 newRoot);
    event OrdersMatched(
        uint256 indexed nullifierHashA,
        uint256 indexed nullifierHashB,
        uint256 outCommitmentA,
        uint256 outCommitmentB,
        uint256 residualCommitmentA,
        uint256 residualCommitmentB,
        uint256 newRoot
    );

    error AssetNotAllowed(uint256 assetId);
    error UnknownRoot(uint256 root);
    error NullifierAlreadySpent(uint256 nullifierHash);
    error InvalidProof();
    error RecipientNotScreened(address recipient);
    error NativeAmountMismatch(uint256 expected, uint256 sent);
    error NativeTransferFailed();

    constructor(
        address hasherAddress,
        address withdrawVerifierAddress,
        address payVerifierAddress,
        address placeOrderVerifierAddress,
        address cancelOrderVerifierAddress,
        address matchOrdersVerifierAddress,
        address admin,
        uint256 nativeAssetIdValue
    ) MerkleTreeWithHistory(hasherAddress) {
        withdrawVerifier = IUltraHonkVerifier(withdrawVerifierAddress);
        payVerifier = IUltraHonkVerifier(payVerifierAddress);
        placeOrderVerifier = IUltraHonkVerifier(placeOrderVerifierAddress);
        cancelOrderVerifier = IUltraHonkVerifier(cancelOrderVerifierAddress);
        matchOrdersVerifier = IUltraHonkVerifier(matchOrdersVerifierAddress);
        nativeAssetId = nativeAssetIdValue;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Allowlists `assetId` against `token`. For `nativeAssetId`,
    ///         pass `token = address(0)` — it's never read for that asset,
    ///         `shield`/`withdraw` handle it via native value instead.
    function setAsset(uint256 assetId, address token, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        assetToken[assetId] = token;
        isAllowedAsset[assetId] = allowed;
        emit AssetAllowlisted(assetId, token, allowed);
    }

    function setComplianceRegistry(address registry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        complianceRegistry = IComplianceRegistry(registry);
        emit ComplianceRegistryUpdated(registry);
    }

    // ---------------------------------------------------------------------
    // Shield / withdraw / pay
    // ---------------------------------------------------------------------

    /// @notice Lock `amount` of the allowlisted asset from the caller and insert
    ///         `commitment` (computed client-side — see circuits/DESIGN.md) as a
    ///         new leaf. No circuit needed: there's nothing secret to prove yet.
    ///         For `nativeAssetId`, send `amount` as the call's native value
    ///         (`msg.value`) instead of holding an ERC20 allowance — any
    ///         contract can hold native value directly, no wrapped-token
    ///         detour needed.
    function shield(uint256 assetId, uint256 amount, uint256 commitment) external payable nonReentrant {
        if (!isAllowedAsset[assetId]) revert AssetNotAllowed(assetId);

        if (assetId == nativeAssetId) {
            if (msg.value != amount) revert NativeAmountMismatch(amount, msg.value);
        } else {
            if (msg.value != 0) revert NativeAmountMismatch(0, msg.value);
            address token = assetToken[assetId];
            if (token == address(0)) revert AssetNotAllowed(assetId);
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        uint32 leafIndex = _insert(commitment);
        emit Shielded(assetId, commitment, leafIndex, currentRoot);
    }

    /// @notice Spend a note, proving Merkle membership + a fresh nullifier via
    ///         `withdrawVerifier`, and pay it out publicly to `recipient`.
    ///         Public-input order must match circuits/noir/withdraw's
    ///         `{public [root, nullifierHash, amount, assetId, recipient]}` order.
    function withdraw(
        bytes calldata proof,
        uint256 root,
        uint256 nullifierHash,
        uint256 amount,
        uint256 assetId,
        address recipient
    ) external nonReentrant {
        if (!isKnownRoot[root]) revert UnknownRoot(root);
        if (isSpentNullifier[nullifierHash]) revert NullifierAlreadySpent(nullifierHash);
        if (!isAllowedAsset[assetId]) revert AssetNotAllowed(assetId);
        if (address(complianceRegistry) != address(0) && !complianceRegistry.isScreened(recipient)) {
            revert RecipientNotScreened(recipient);
        }

        bytes32[] memory publicInputs = new bytes32[](5);
        publicInputs[0] = bytes32(root);
        publicInputs[1] = bytes32(nullifierHash);
        publicInputs[2] = bytes32(amount);
        publicInputs[3] = bytes32(assetId);
        publicInputs[4] = bytes32(uint256(uint160(recipient)));
        if (!withdrawVerifier.verify(proof, publicInputs)) revert InvalidProof();

        isSpentNullifier[nullifierHash] = true;
        if (assetId == nativeAssetId) {
            (bool success, ) = recipient.call{value: amount}("");
            if (!success) revert NativeTransferFailed();
        } else {
            address token = assetToken[assetId];
            if (token == address(0)) revert AssetNotAllowed(assetId);
            IERC20(token).safeTransfer(recipient, amount);
        }
        emit Withdrawn(assetId, nullifierHash, recipient, amount);
    }

    /// @notice Spend a note, proving Merkle membership + a fresh nullifier via
    ///         `payVerifier`, and insert `outCommitment` (the recipient's new
    ///         hidden note, computed client-side) as a new leaf — funds never
    ///         leave the shielded pool. Compliance screening doesn't apply
    ///         here on purpose: there's no plaintext recipient to screen until
    ///         `withdraw` brings funds back into the open. Amount is private —
    ///         the circuit itself recomputes `outCommitment` from the spent
    ///         note's real amount and asserts equality, so this contract never
    ///         needs to see or pass it through.
    function pay(bytes calldata proof, uint256 root, uint256 nullifierHash, uint256 assetId, uint256 outCommitment)
        external
        nonReentrant
    {
        if (!isKnownRoot[root]) revert UnknownRoot(root);
        if (isSpentNullifier[nullifierHash]) revert NullifierAlreadySpent(nullifierHash);
        if (!isAllowedAsset[assetId]) revert AssetNotAllowed(assetId);

        bytes32[] memory publicInputs = new bytes32[](4);
        publicInputs[0] = bytes32(root);
        publicInputs[1] = bytes32(nullifierHash);
        publicInputs[2] = bytes32(assetId);
        publicInputs[3] = bytes32(outCommitment);
        if (!payVerifier.verify(proof, publicInputs)) revert InvalidProof();

        isSpentNullifier[nullifierHash] = true;
        uint32 leafIndex = _insert(outCommitment);
        emit Paid(assetId, nullifierHash, outCommitment, leafIndex, currentRoot);
    }

    // ---------------------------------------------------------------------
    // Dark pool: placeOrder / cancelOrder / matchOrders
    // ---------------------------------------------------------------------

    /// @notice Spend a regular note and insert a hidden order commitment in
    ///         its place. Unlike withdraw/pay, no amount/asset details are
    ///         public here — only the matcher, who receives the order off-chain
    ///         (encrypted), knows what's actually in it. See circuits/DESIGN.md.
    function placeOrder(bytes calldata proof, uint256 root, uint256 nullifierHash, uint256 orderCommitment)
        external
        nonReentrant
    {
        if (!isKnownRoot[root]) revert UnknownRoot(root);
        if (isSpentNullifier[nullifierHash]) revert NullifierAlreadySpent(nullifierHash);

        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = bytes32(root);
        publicInputs[1] = bytes32(nullifierHash);
        publicInputs[2] = bytes32(orderCommitment);
        if (!placeOrderVerifier.verify(proof, publicInputs)) revert InvalidProof();

        isSpentNullifier[nullifierHash] = true;
        uint32 leafIndex = _insert(orderCommitment);
        emit OrderPlaced(nullifierHash, orderCommitment, leafIndex, currentRoot);
    }

    /// @notice Spend a hidden order commitment and insert a regular, spendable
    ///         note back for the original amount/asset — cancelling an order.
    function cancelOrder(bytes calldata proof, uint256 root, uint256 nullifierHash, uint256 refundCommitment)
        external
        nonReentrant
    {
        if (!isKnownRoot[root]) revert UnknownRoot(root);
        if (isSpentNullifier[nullifierHash]) revert NullifierAlreadySpent(nullifierHash);

        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = bytes32(root);
        publicInputs[1] = bytes32(nullifierHash);
        publicInputs[2] = bytes32(refundCommitment);
        if (!cancelOrderVerifier.verify(proof, publicInputs)) revert InvalidProof();

        isSpentNullifier[nullifierHash] = true;
        uint32 leafIndex = _insert(refundCommitment);
        emit OrderCancelled(nullifierHash, refundCommitment, leafIndex, currentRoot);
    }

    /// @notice Spend two compatible hidden order commitments and insert the
    ///         matched output notes, supporting partial fills: the proof
    ///         itself already establishes both orders are valid, cross on
    ///         assets, at least one side is fully consumed, and each side's
    ///         contribution clears the other's pro-rata minimum acceptable
    ///         amount for however much was actually filled
    ///         (circuits/noir/match_orders). `residualCommitmentA/B` are
    ///         `ZERO_VALUE` (the domain-separated empty-leaf constant — see
    ///         MerkleTreeWithHistory) when that side was fully consumed and
    ///         has no leftover; a real order commitment can never equal it,
    ///         so the sentinel is unambiguous and only a genuine leftover
    ///         ever gets inserted as a new leaf. See circuits/DESIGN.md.
    function matchOrders(
        bytes calldata proof,
        uint256 root,
        uint256 nullifierHashA,
        uint256 nullifierHashB,
        uint256 outCommitmentA,
        uint256 outCommitmentB,
        uint256 residualCommitmentA,
        uint256 residualCommitmentB
    ) external nonReentrant {
        if (!isKnownRoot[root]) revert UnknownRoot(root);
        if (isSpentNullifier[nullifierHashA]) revert NullifierAlreadySpent(nullifierHashA);
        if (isSpentNullifier[nullifierHashB]) revert NullifierAlreadySpent(nullifierHashB);

        bytes32[] memory publicInputs = new bytes32[](7);
        publicInputs[0] = bytes32(root);
        publicInputs[1] = bytes32(nullifierHashA);
        publicInputs[2] = bytes32(nullifierHashB);
        publicInputs[3] = bytes32(outCommitmentA);
        publicInputs[4] = bytes32(outCommitmentB);
        publicInputs[5] = bytes32(residualCommitmentA);
        publicInputs[6] = bytes32(residualCommitmentB);
        if (!matchOrdersVerifier.verify(proof, publicInputs)) revert InvalidProof();

        isSpentNullifier[nullifierHashA] = true;
        isSpentNullifier[nullifierHashB] = true;
        _insert(outCommitmentA);
        _insert(outCommitmentB);
        if (residualCommitmentA != ZERO_VALUE) _insert(residualCommitmentA);
        if (residualCommitmentB != ZERO_VALUE) _insert(residualCommitmentB);
        emit OrdersMatched(nullifierHashA, nullifierHashB, outCommitmentA, outCommitmentB, residualCommitmentA, residualCommitmentB, currentRoot);
    }
}

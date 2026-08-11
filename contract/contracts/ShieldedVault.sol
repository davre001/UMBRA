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

/// @notice Minimal surface `depositExternal` needs from a source chain's
///         wrapped collateral token (see tokens/WrappedBTC.sol) — the vault
///         mints real, public collateral directly to the proven recipient
///         rather than inserting a private note commitment.
interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
}

/// @notice Public inputs a `depositExternal` proof commits to. Field types
///         and order must match the source circuit's `main()` exactly —
///         `checkpointRoot`/`recipient`/`amount`/`nullifier` map 1:1 onto
///         btc_deposit's `(checkpoint_commitment_pub, recipient, amount,
///         nullifier)` public inputs, in that order (see
///         circuits/BTC_DEPOSIT_DESIGN.md). `checkpointRoot` is that
///         circuit's Poseidon2 checkpoint COMMITMENT, not a raw hash — a
///         raw `pub [u8; 32]` would expand into 32 separate public-input
///         slots, not one `bytes32` (see that doc's "Public-input
///         interface" section for why this matters). `recipient` is a real
///         EVM address (the circuit binds it from a Bitcoin OP_RETURN
///         output — see bitcoin::parse_deposit_tx), not an opaque
///         ownerKey — deposits mint real, public collateral, not a hidden
///         note. Bitcoin only ever represents one asset, so there's no
///         asset-selection field — that's the one piece a future Ethereum
///         deposit circuit's version of this struct would need that this
///         one doesn't.
struct ExternalDeposit {
    bytes32 sourceChainId;
    bytes32 checkpointRoot;
    address recipient;
    uint256 amount;
    bytes32 nullifier;
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

    /// @notice Verifiers trusted for `depositExternal` — a mapping, not a
    ///         fixed immutable like every other action's verifier, so a
    ///         future chain's deposit circuit (e.g. Ethereum) can register
    ///         its own verifier without a new entrypoint. See
    ///         circuits/BTC_DEPOSIT_DESIGN.md's Phase 5 section.
    mapping(address => bool) public trustedVerifiers;

    /// @notice Trusted checkpoint per external chain — sourceChainId is an
    ///         opaque tag (e.g. `keccak256("BTC_SIGNET")`), checkpointRoot
    ///         is that circuit's Poseidon2 checkpoint commitment (NOT the
    ///         raw checkpoint hash — see BTC_DEPOSIT_DESIGN.md's
    ///         "Public-input interface" section for why). A mapping from
    ///         day one, not a single hardcoded BTC checkpoint variable —
    ///         the entire cost of staying generalized to future chains,
    ///         and expensive to retrofit as a storage migration later.
    mapping(bytes32 => bytes32) public checkpoints;

    /// @notice The wrapped-collateral token `depositExternal` mints into for
    ///         each `sourceChainId` (e.g. `keccak256("BTC_SIGNET")` =>
    ///         WrappedBTC — see tokens/WrappedBTC.sol). That token must also
    ///         be registered via `setAsset` against the circuit's own
    ///         assetId (e.g. `bitcoin::BTC_ASSET_ID`) so `shield`/`withdraw`/
    ///         `pay` treat it as ordinary allowlisted collateral once
    ///         minted — `depositExternal` itself never touches
    ///         `isAllowedAsset`.
    mapping(bytes32 => address) public externalDepositToken;

    /// @notice AssetIds sourced only via `depositExternal` with no real
    ///         EVM-side collateral backing them (kept for a future chain
    ///         whose bridge can't mint real collateral — BTC itself no
    ///         longer uses this path now that `depositExternal` mints real
    ///         WrappedBTC, see `externalDepositToken`). For an asset marked
    ///         here, `withdraw` never attempts an ERC20/native transfer;
    ///         instead it emits `ExternalWithdrawalRequested` for an
    ///         off-chain relayer to fulfill on the real external chain.
    ///         Independent of `isAllowedAsset` by design, so a future admin
    ///         mistake on one doesn't silently defeat the other's guarantee.
    mapping(uint256 => bool) public isExternalSourceAsset;

    IComplianceRegistry public complianceRegistry;

    event AssetAllowlisted(uint256 indexed assetId, address indexed token, bool allowed);
    event ExternalSourceAssetUpdated(uint256 indexed assetId, bool isExternal);
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
    event VerifierTrustUpdated(address indexed verifier, bool trusted);
    event CheckpointUpdated(bytes32 indexed sourceChainId, bytes32 checkpointRoot);
    event ExternalDepositTokenUpdated(bytes32 indexed sourceChainId, address indexed token);
    event ExternalDeposited(
        bytes32 indexed sourceChainId, bytes32 indexed nullifier, address indexed recipient, uint256 amount
    );
    /// @notice `destination` is NOT an Ethereum address — for BTC it's a
    ///         20-byte P2WPKH pubkey hash (hash160), reusing `withdraw`'s
    ///         existing `address`-shaped `recipient` public input purely
    ///         for its bit width (both are 160 bits). See
    ///         circuits/BTC_DEPOSIT_DESIGN.md's "Withdrawal" section.
    event ExternalWithdrawalRequested(
        uint256 indexed assetId, uint256 indexed nullifierHash, address destination, uint256 amount
    );

    error AssetNotAllowed(uint256 assetId);
    error UnknownRoot(uint256 root);
    error NullifierAlreadySpent(uint256 nullifierHash);
    error InvalidProof();
    error RecipientNotScreened(address recipient);
    error NativeAmountMismatch(uint256 expected, uint256 sent);
    error NativeTransferFailed();
    error UnknownVerifier(address verifier);
    error StaleCheckpoint(bytes32 sourceChainId, bytes32 provided, bytes32 expected);
    error NoDepositToken(bytes32 sourceChainId);

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

    /// @notice Marks `assetId` as sourced only via `depositExternal` — `withdraw`
    ///         will unconditionally revert `ExternalSourceAssetNotWithdrawable`
    ///         for it from this point on, independent of `isAllowedAsset`
    ///         (see that mapping's own NatSpec for why this independence
    ///         matters). Call once per external-chain assetId at deployment
    ///         time (e.g. `setExternalSourceAsset(999, true)` for
    ///         `bitcoin::BTC_ASSET_ID`) — `depositExternal` itself has no
    ///         assetId field to auto-derive this from (Bitcoin is a single
    ///         asset by design, see `ExternalDeposit`'s own NatSpec).
    function setExternalSourceAsset(uint256 assetId, bool isExternal) external onlyRole(DEFAULT_ADMIN_ROLE) {
        isExternalSourceAsset[assetId] = isExternal;
        emit ExternalSourceAssetUpdated(assetId, isExternal);
    }

    /// @notice Trusts (or revokes trust in) `verifier` for `depositExternal`.
    ///         Operational trust assumption: the admin must only trust a
    ///         verifier alongside a correctly-matched `checkpoints[sourceChainId]`
    ///         registration for that same circuit's real source chain —
    ///         `depositExternal` itself does not cryptographically bind a
    ///         specific verifier to a specific `sourceChainId`, since the
    ///         checkpoint-commitment equality check is what actually does
    ///         the real work (a checkpoint commitment is a Poseidon2 hash
    ///         of real chain-specific header data — collisions across
    ///         unrelated chains' checkpoints aren't a practical concern).
    function setTrustedVerifier(address verifier, bool trusted) external onlyRole(DEFAULT_ADMIN_ROLE) {
        trustedVerifiers[verifier] = trusted;
        emit VerifierTrustUpdated(verifier, trusted);
    }

    /// @notice Registers (or rotates) the trusted checkpoint for `sourceChainId`.
    ///         `checkpointRoot` must be that source's Poseidon2 checkpoint
    ///         COMMITMENT (e.g. `bitcoin::checkpoint_commitment` for BTC),
    ///         not a raw checkpoint hash — see `ExternalDeposit`'s own doc.
    function setCheckpoint(bytes32 sourceChainId, bytes32 checkpointRoot) external onlyRole(DEFAULT_ADMIN_ROLE) {
        checkpoints[sourceChainId] = checkpointRoot;
        emit CheckpointUpdated(sourceChainId, checkpointRoot);
    }

    /// @notice Registers the wrapped-collateral token `depositExternal`
    ///         mints into for `sourceChainId`. The vault must separately
    ///         hold MINTER_ROLE on that token (e.g. WrappedBTC), and the
    ///         token must separately be allowlisted via `setAsset` against
    ///         the matching circuit assetId for `shield`/`withdraw`/`pay`
    ///         to treat it as spendable collateral.
    function setExternalDepositToken(bytes32 sourceChainId, address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        externalDepositToken[sourceChainId] = token;
        emit ExternalDepositTokenUpdated(sourceChainId, token);
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
    ///         `withdrawVerifier`. For an ordinary asset, pays out publicly
    ///         to `recipient` directly. For an `isExternalSourceAsset` (BTC
    ///         — see that mapping's own NatSpec), no ERC20/native transfer
    ///         is ever attempted — there's no real collateral here to move
    ///         — instead `ExternalWithdrawalRequested` is emitted for the
    ///         off-chain relayer (`backend/src/btc-withdrawal/`) to fulfill
    ///         on the real chain, with `recipient`'s low 160 bits
    ///         reinterpreted as that chain's own destination (a Bitcoin
    ///         hash160, for BTC). Public-input order must match
    ///         circuits/noir/withdraw's `{public [root, nullifierHash,
    ///         amount, assetId, recipient]}` order in both cases — the
    ///         circuit itself doesn't know or care which branch this
    ///         contract takes with its own opaque `recipient` field, since
    ///         the destination was always going to become public the
    ///         moment a note left the shielded pool either way (see
    ///         circuits/noir/withdraw's own design note on this).
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

        bool isExternal = isExternalSourceAsset[assetId];
        if (!isExternal) {
            if (!isAllowedAsset[assetId]) revert AssetNotAllowed(assetId);
            // Compliance screening is an EVM-address concept — skipped for
            // external-source assets, whose `recipient` bits are never a
            // real Ethereum account to begin with (see NatSpec above).
            if (address(complianceRegistry) != address(0) && !complianceRegistry.isScreened(recipient)) {
                revert RecipientNotScreened(recipient);
            }
        }

        bytes32[] memory publicInputs = new bytes32[](5);
        publicInputs[0] = bytes32(root);
        publicInputs[1] = bytes32(nullifierHash);
        publicInputs[2] = bytes32(amount);
        publicInputs[3] = bytes32(assetId);
        publicInputs[4] = bytes32(uint256(uint160(recipient)));
        if (!withdrawVerifier.verify(proof, publicInputs)) revert InvalidProof();

        isSpentNullifier[nullifierHash] = true;
        if (isExternal) {
            emit ExternalWithdrawalRequested(assetId, nullifierHash, recipient, amount);
            return;
        }
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
    ///         needs to see or pass it through. An isExternalSourceAsset note
    ///         (BTC) is exempt from the `isAllowedAsset` allowlist for the
    ///         same reason `withdraw()`'s own `isExternal` branch is — it was
    ///         never added to that mapping (only to isExternalSourceAsset),
    ///         so without this exemption every BTC-backed note would be
    ///         permanently stuck: mintable via depositExternal, payable to no
    ///         one. Nothing else about `pay()` needs to change — assetId is
    ///         already an opaque Field to payVerifier regardless of what
    ///         backs it on-chain.
    function pay(bytes calldata proof, uint256 root, uint256 nullifierHash, uint256 assetId, uint256 outCommitment)
        external
        nonReentrant
    {
        if (!isKnownRoot[root]) revert UnknownRoot(root);
        if (isSpentNullifier[nullifierHash]) revert NullifierAlreadySpent(nullifierHash);
        if (!isExternalSourceAsset[assetId] && !isAllowedAsset[assetId]) revert AssetNotAllowed(assetId);

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

    // ---------------------------------------------------------------------
    // External deposits (currently: Bitcoin signet — see
    // circuits/BTC_DEPOSIT_DESIGN.md)
    // ---------------------------------------------------------------------

    /// @notice Mints real, public wrapped collateral from a proven
    ///         external-chain deposit — currently, a real Bitcoin signet
    ///         payment (see circuits/BTC_DEPOSIT_DESIGN.md) — directly to
    ///         `deposit.recipient`, the EVM address the circuit itself
    ///         extracted and bound from the Bitcoin OP_RETURN output. One
    ///         generic entrypoint, chain-tagged via `deposit.sourceChainId`,
    ///         rather than a bespoke `depositBTC` — so a future chain's
    ///         deposit circuit only needs its own verifier + checkpoint +
    ///         `externalDepositToken` registration, not a new entrypoint or
    ///         a storage migration. The mint lands as an ordinary public
    ///         ERC20 balance — from there the recipient uses `shield` like
    ///         any other asset to bring it into the private pool; there is
    ///         no bespoke private-note path here anymore.
    function depositExternal(IUltraHonkVerifier verifier, bytes calldata proof, ExternalDeposit calldata deposit)
        external
        nonReentrant
    {
        if (!trustedVerifiers[address(verifier)]) revert UnknownVerifier(address(verifier));
        bytes32 expectedCheckpoint = checkpoints[deposit.sourceChainId];
        if (expectedCheckpoint != deposit.checkpointRoot) {
            revert StaleCheckpoint(deposit.sourceChainId, deposit.checkpointRoot, expectedCheckpoint);
        }
        if (isSpentNullifier[uint256(deposit.nullifier)]) revert NullifierAlreadySpent(uint256(deposit.nullifier));
        address token = externalDepositToken[deposit.sourceChainId];
        if (token == address(0)) revert NoDepositToken(deposit.sourceChainId);

        // Order must match the source circuit's public inputs exactly —
        // btc_deposit's `main()` declares (checkpoint_commitment_pub,
        // recipient, amount, nullifier), in that order.
        bytes32[] memory publicInputs = new bytes32[](4);
        publicInputs[0] = deposit.checkpointRoot;
        publicInputs[1] = bytes32(uint256(uint160(deposit.recipient)));
        publicInputs[2] = bytes32(deposit.amount);
        publicInputs[3] = deposit.nullifier;
        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        isSpentNullifier[uint256(deposit.nullifier)] = true;
        IMintableERC20(token).mint(deposit.recipient, deposit.amount);
        emit ExternalDeposited(deposit.sourceChainId, deposit.nullifier, deposit.recipient, deposit.amount);
    }
}

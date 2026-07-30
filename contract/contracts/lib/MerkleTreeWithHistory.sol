// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Field} from "./poseidon2/Field.sol";
import {Poseidon2_BN254} from "./poseidon2/Poseidon2.sol";

/// @title MerkleTreeWithHistory
/// @notice Incremental Merkle tree of note commitments, depth 20 (same choice
///         Tornado Cash uses — 2^20 notes per pool, plenty for testnet).
///         Same "filled subtrees" incremental-insert algorithm as Tornado's
///         MerkleTreeWithHistory.sol. Every root that has ever been current
///         stays valid forever (`isKnownRoot`), not just a bounded recent
///         window — simpler than a ring buffer and correctness doesn't
///         depend on bounding it at this stage.
/// @dev See circuits/DESIGN.md for the full note/commitment/nullifier design
///      this tree is part of. Uses Poseidon2 (via the vendored, empirically-
///      verified zemse/poseidon2-evm — see contracts/lib/poseidon2/), matching
///      the Noir circuits' hash.
abstract contract MerkleTreeWithHistory {
    uint32 public constant LEVELS = 20;
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // Domain-separated zero leaf — matches circuits/noir/lib/src/lib.nr's
    // ZERO_VALUE exactly (keccak256("umbra-shielded-vault-noir") % FIELD_SIZE),
    // so nobody can craft a real note whose commitment collides with an
    // empty slot's default value.
    uint256 public constant ZERO_VALUE =
        6553590586423608260410254385500912220875115508942847723390064418770335574135;

    Poseidon2_BN254 public immutable hasher;

    uint256[LEVELS] public filledSubtrees;
    uint256[LEVELS + 1] public zeros;
    uint32 public nextLeafIndex;
    uint256 public currentRoot;
    mapping(uint256 => bool) public isKnownRoot;

    constructor(address hasherAddress) {
        hasher = Poseidon2_BN254(hasherAddress);

        zeros[0] = ZERO_VALUE;
        for (uint32 i = 1; i <= LEVELS; i++) {
            zeros[i] = _hashLeftRight(zeros[i - 1], zeros[i - 1]);
        }

        currentRoot = zeros[LEVELS];
        isKnownRoot[currentRoot] = true;
    }

    function _hashLeftRight(uint256 left, uint256 right) internal view returns (uint256) {
        return Field.Type.unwrap(hasher.hash_2(Field.Type.wrap(left), Field.Type.wrap(right)));
    }

    /// @dev Inserts `leaf` as the next commitment and recomputes the path to
    ///      the root — O(LEVELS) hashes, not a full tree rebuild.
    function _insert(uint256 leaf) internal returns (uint32 insertedIndex) {
        uint32 currentIndex = nextLeafIndex;
        require(currentIndex != uint32(2 ** LEVELS), "MerkleTree: full");

        uint256 currentLevelHash = leaf;
        for (uint32 i = 0; i < LEVELS; i++) {
            uint256 left;
            uint256 right;
            if (currentIndex % 2 == 0) {
                left = currentLevelHash;
                right = zeros[i];
                filledSubtrees[i] = currentLevelHash;
            } else {
                left = filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = _hashLeftRight(left, right);
            currentIndex /= 2;
        }

        currentRoot = currentLevelHash;
        isKnownRoot[currentLevelHash] = true;
        insertedIndex = nextLeafIndex;
        nextLeafIndex = insertedIndex + 1;
    }
}

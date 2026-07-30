// SPDX-License-Identifier: MIT
// Vendored from https://github.com/zemse/poseidon2-evm (MIT), unmodified.
// hash_2's output was empirically verified byte-for-byte against
// noir-lang/poseidon's Poseidon2::hash([a,b], 2) for three test cases before
// use — see circuits/README.md. Only hash_2 is used by this app, for the
// Merkle tree's internal node hashing; commitment/nullifier hashing (which
// use hash_4/hash_1 with a different sponge IV) happen client-side only,
// never on-chain, so those were not independently verified here.

pragma solidity >=0.8.8;

import {Field} from "./Field.sol";
import {LibPoseidon2} from "./LibPoseidon2.sol";

contract Poseidon2_BN254 {
    using Field for *;

    function hash_1(Field.Type x) public pure returns (Field.Type) {
        return LibPoseidon2.hash_1(x);
    }

    function hash_2(Field.Type x, Field.Type y) public pure returns (Field.Type) {
        return LibPoseidon2.hash_2(x, y);
    }

    function hash_3(Field.Type x, Field.Type y, Field.Type z) public pure returns (Field.Type) {
        return LibPoseidon2.hash_3(x, y, z);
    }

    function hash(Field.Type[] memory input) public pure returns (Field.Type) {
        return LibPoseidon2.hash(input, input.length, false);
    }

    function hash(Field.Type[] memory input, uint256 std_input_length, bool is_variable_length)
        public
        pure
        returns (Field.Type)
    {
        return LibPoseidon2.hash(input, std_input_length, is_variable_length);
    }
}

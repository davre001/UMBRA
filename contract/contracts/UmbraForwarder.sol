// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/// @title UmbraForwarder
/// @notice Not currently wired to ShieldedVault. It was written for gasless
///         withdrawals under the old account-balance model; the real
///         note-based ShieldedVault (see circuits/DESIGN.md) doesn't need a
///         forwarder for withdraw/pay at all — the ZK proof itself is the
///         authorization, so anyone (a relayer included) can already submit
///         those calls directly, paying gas themselves, with no signature
///         delegation required. `shield` still needs the real depositor's own
///         transferFrom-approved transaction, which this wouldn't make
///         gasless anyway. Kept in case a real use for meta-tx relaying shows
///         up later (e.g. gasless `shield` via ERC20Permit); otherwise this
///         is dead code right now. Thin wrapper around OpenZeppelin's audited
///         ERC2771Forwarder so we get an on-brand EIP-712 domain name.
contract UmbraForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("UmbraForwarder") {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title WrappedBTC
/// @notice Public, real ERC20 collateral minted 1:1 (in satoshis) against
///         Bitcoin signet deposits proven by `btc_deposit`'s circuit — see
///         ShieldedVault.depositExternal, which holds MINTER_ROLE and mints
///         directly to the depositor's EVM recipient address extracted from
///         the proven Bitcoin OP_RETURN output. From that point on this
///         token is ordinary allowlisted collateral: `shield`/`withdraw`/
///         `pay`/dark-pool orders all move it exactly like FXRP or USDT0,
///         with no BTC-specific branching anywhere else in the vault.
/// @dev 8 decimals to match Bitcoin's own satoshi denomination — 1 token
///      unit here is 1 satoshi, so amounts round-trip the circuit's parsed
///      `amount` (in sats) without any scaling.
contract WrappedBTC is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor(address admin) ERC20("Wrapped BTC (UMBRA)", "wBTC-U") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }
}

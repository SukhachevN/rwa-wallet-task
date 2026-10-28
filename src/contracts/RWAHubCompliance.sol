// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Demo compliance module. Always allows transfers so the frontend can verify the marketplace.
contract RWAHubCompliance {
    function canTransfer(address, address, uint256, uint256) external pure returns (bool) {
        return true;
    }

    function transferred(address, address, uint256, uint256) external pure {}
}

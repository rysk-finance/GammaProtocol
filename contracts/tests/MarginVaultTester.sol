pragma solidity =0.6.10;

// SPDX-License-Identifier: UNLICENSED
pragma experimental ABIEncoderV2;

import {MarginVault} from "../libs/MarginVault.sol";

contract MarginVaultTester {
    using MarginVault for MarginVault.Vault;

    mapping(address => mapping(uint256 => MarginVault.Vault)) private vault;

    function getVault(uint256 _vaultIndex) external view returns (MarginVault.Vault memory) {
        return vault[msg.sender][_vaultIndex];
    }

    function testAddShort(
        uint256 _vaultIndex,
        address _shortOtoken,
        uint256 _amount,
        uint256 _index
    ) external {
        vault[msg.sender][_vaultIndex].addShort(_shortOtoken, _amount);
    }

    function testRemoveShort(
        uint256 _vaultIndex,
        address _shortOtoken,
        uint256 _amount,
        uint256 _index
    ) external {
        vault[msg.sender][_vaultIndex].removeShort(_shortOtoken, _amount);
    }

    function testAddLong(
        uint256 _vaultIndex,
        address _longOtoken,
        uint256 _amount,
        uint256 _index
    ) external {
        vault[msg.sender][_vaultIndex].addLong(_longOtoken, _amount);
    }

    function testRemoveLong(
        uint256 _vaultIndex,
        address _longOtoken,
        uint256 _amount,
        uint256 _index
    ) external {
        vault[msg.sender][_vaultIndex].removeLong(_longOtoken, _amount);
    }

    function testAddCollateral(
        uint256 _vaultIndex,
        address _collateralAsset,
        uint256 _amount,
        uint256 _index
    ) external {
        vault[msg.sender][_vaultIndex].addCollateral(_collateralAsset, _amount);
    }

    function testRemoveCollateral(
        uint256 _vaultIndex,
        address _collateralAsset,
        uint256 _amount,
        uint256 _index
    ) external {
        vault[msg.sender][_vaultIndex].removeCollateral(_collateralAsset, _amount);
    }
}

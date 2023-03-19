// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.6.10;

pragma experimental ABIEncoderV2;

import {Actions} from "../libs/Actions.sol";

import {MarginVault} from "../libs/MarginVault.sol";

interface ControllerInterface {
    /* Getters */
    function getAccountVaultCounter(address _accountOwner) external view returns (uint256);

    function getVaultWithDetails(address _owner, uint256 _vaultId)
        external
        view
        returns (
            MarginVault.Vault memory,
            uint256,
            uint256
        );

    /* Admin-only functions */
    function operate(Actions.ActionArgs[] memory _actions) external;
}

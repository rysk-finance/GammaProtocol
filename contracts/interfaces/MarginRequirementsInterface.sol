// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.6.10;

pragma experimental ABIEncoderV2;

import {MarginVault} from "../libs/MarginVault.sol";

interface MarginRequirementsInterface {
    using MarginVault for MarginVault.Vault;

    //WIP
    /*     function checkNotionalSize(
        uint256 currentOtokenBalance,
        uint256 mintAmount,
        address underlying
    ) external view returns (bool);

    function checkWithdrawCollateral(
        address account,
        uint256 index,
        uint256 vaultId,
        uint256 withdrawAmount,
        MarginVault.Vault memory
    ) external view returns (bool);

    function checkMintCollateral(
        uint256 index,
        address account,
        uint256 mintAmount,
        MarginVault.Vault memory
    ) external view returns (bool); */

    /* Controller-only functions */
    function clearMaintenanceMargin(address _account, uint256 _vaultId) external;
}

// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.6.10;

pragma experimental ABIEncoderV2;

import {MarginVault} from "../libs/MarginVault.sol";

interface MarginRequirementsInterface {
    using MarginVault for MarginVault.Vault;

    function checkWithdrawCollateral(
        address _account,
        uint256 _withdrawAmount,
        address _otokenAddress,
        address _underlying,
        uint256 _vaultId,
        MarginVault.Vault memory _vault
    ) external view returns (bool);

    function checkMintCollateral(
        address _account,
        uint256 _notional,
        address _underlyingAsset,
        bool isPut,
        uint256 _collateralAmount,
        address _collateralAsset
    ) external view returns (bool);

    /* Controller-only functions */
    function clearMaintenanceMargin(address _account, uint256 _vaultId) external;
}

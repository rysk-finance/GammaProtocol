// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.6.10;

interface IOtokenFactoryInterface {
    function createOtoken(
        address _underlyingAsset,
        address _strikeAsset,
        address _collateralAsset,
        uint256 _strikePrice,
        uint256 _expiry,
        bool _isPut
    ) external returns (address);
}

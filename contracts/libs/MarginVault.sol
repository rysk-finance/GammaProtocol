/**
 * SPDX-License-Identifier: UNLICENSED
 */
pragma solidity =0.6.10;

pragma experimental ABIEncoderV2;

import {SafeMath} from "../packages/oz/SafeMath.sol";
import {SafeMath128} from "../packages/oz/SafeMath128.sol";

/**
 * MarginVault Error Codes
 * V1: invalid short otoken amount
 * V2: invalid short otoken index
 * V3: short otoken address mismatch
 * V4: invalid long otoken amount
 * V5: invalid long otoken index
 * V6: long otoken address mismatch
 * V7: invalid collateral amount
 * V8: invalid collateral token index
 * V9: collateral token address mismatch
 */

/**
 * @title MarginVault
 * @author Opyn Team
 * @notice A library that provides the Controller with a Vault struct and the functions that manipulate vaults.
 * Vaults describe discrete position combinations of long options, short options, and collateral assets that a user can have.
 */
library MarginVault {
    using SafeMath for uint256;
    using SafeMath128 for uint128;

    // vault is a struct of 6 arrays that describe a position a user has, a user can have multiple vaults.
    struct Vault {
        // addresses of oTokens a user has shorted (i.e. written) against this vault
        address shortOtokens;
        // addresses of oTokens a user has bought and deposited in this vault
        // user can be long oTokens without opening a vault (e.g. by buying on a DEX)
        // generally, long oTokens will be 'deposited' in vaults to act as collateral in order to write oTokens against (i.e. in spreads)
        address longOtokens;
        // addresses of other ERC-20s a user has deposited as collateral in this vault
        address collateralAssets;
        // quantity of oTokens minted/written for each oToken address in shortOtokens
        uint128 shortAmounts;
        // quantity of ERC-20 deposited as collateral in the vault for each ERC-20 address in collateralAssets
        uint128 collateralAmounts;
        // quantity of oTokens owned and held in the vault for each oToken address in longOtokens
        uint128 longAmounts;

    }

    /**
     * @dev increase the short oToken balance in a vault when a new oToken is minted
     * @param _vault vault to add or increase the short position in
     * @param _shortOtoken address of the _shortOtoken being minted from the user's vault
     * @param _amount number of _shortOtoken being minted from the user's vault
     */
    function addShort(
        Vault storage _vault,
        address _shortOtoken,
        uint256 _amount
    ) external {
        require(_amount > 0, "V1");
        if (_vault.shortOtokens == address(0) && _vault.shortAmounts == 0) {
            _vault.shortOtokens = _shortOtoken;
            _vault.shortAmounts = uint128(_amount);
        } else {
            require(_vault.shortOtokens == _shortOtoken, "V3");
            _vault.shortAmounts = _vault.shortAmounts.add(uint128(_amount));
        }

    }

    /**
     * @dev decrease the short oToken balance in a vault when an oToken is burned
     * @param _vault vault to decrease short position in
     * @param _shortOtoken address of the _shortOtoken being reduced in the user's vault
     * @param _amount number of _shortOtoken being reduced in the user's vault
     */
    function removeShort(
        Vault storage _vault,
        address _shortOtoken,
        uint256 _amount
    ) external {
        require(_vault.shortOtokens == _shortOtoken, "V3");

        uint128 newShortAmount = _vault.shortAmounts.sub(uint128(_amount));

        if (newShortAmount == 0) {
            delete _vault.shortOtokens;
        }
        _vault.shortAmounts = newShortAmount;
    }

    /**
     * @dev increase the long oToken balance in a vault when an oToken is deposited
     * @param _vault vault to add a long position to
     * @param _longOtoken address of the _longOtoken being added to the user's vault
     * @param _amount number of _longOtoken the protocol is adding to the user's vault
     */
    function addLong(
        Vault storage _vault,
        address _longOtoken,
        uint256 _amount
    ) external {
        require(_amount > 0, "V4");
        if (_vault.longOtokens == address(0) && _vault.longAmounts == 0) {
            _vault.longOtokens = _longOtoken;
            _vault.longAmounts = uint128(_amount);
        } else {
            require(_vault.longOtokens == _longOtoken, "V3");
            _vault.longAmounts = _vault.longAmounts.add(uint128(_amount));
        }

    }

    /**
     * @dev decrease the long oToken balance in a vault when an oToken is withdrawn
     * @param _vault vault to remove a long position from
     * @param _longOtoken address of the _longOtoken being removed from the user's vault
     * @param _amount number of _longOtoken the protocol is removing from the user's vault
     */
    function removeLong(
        Vault storage _vault,
        address _longOtoken,
        uint256 _amount
    ) external {
        require(_vault.longOtokens == _longOtoken, "V6");

        uint128 newLongAmount = _vault.longAmounts.sub(uint128(_amount));

        if (newLongAmount == 0) {
            delete _vault.longOtokens;
        }
        _vault.longAmounts = newLongAmount;
    }

    /**
     * @dev increase the collateral balance in a vault
     * @param _vault vault to add collateral to
     * @param _collateralAsset address of the _collateralAsset being added to the user's vault
     * @param _amount number of _collateralAsset being added to the user's vault
     */
    function addCollateral(
        Vault storage _vault,
        address _collateralAsset,
        uint256 _amount
    ) external {
        require(_amount > 0, "V7");
        if (_vault.collateralAssets == address(0) && _vault.collateralAmounts == 0) {
            _vault.collateralAssets = _collateralAsset;
            _vault.collateralAmounts = uint128(_amount);
        } else {
            require(_vault.collateralAssets == _collateralAsset, "V3");
            _vault.collateralAmounts = _vault.collateralAmounts.add(uint128(_amount));
        }
    }

    /**
     * @dev decrease the collateral balance in a vault
     * @param _vault vault to remove collateral from
     * @param _collateralAsset address of the _collateralAsset being removed from the user's vault
     * @param _amount number of _collateralAsset being removed from the user's vault
     */
    function removeCollateral(
        Vault storage _vault,
        address _collateralAsset,
        uint256 _amount
    ) external {
        require(_vault.collateralAssets == _collateralAsset, "V9");

        uint128 newCollateralAmount = _vault.collateralAmounts.sub(uint128(_amount));

        if (newCollateralAmount == 0) {
            delete _vault.collateralAssets;
        }
        _vault.collateralAmounts = newCollateralAmount;
    }
}

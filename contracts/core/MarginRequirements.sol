/**
 * SPDX-License-Identifier: UNLICENSED
 */
pragma solidity =0.6.10;

pragma experimental ABIEncoderV2;

import {Ownable} from "../packages/oz/Ownable.sol";
import {OtokenInterface} from "../interfaces/OtokenInterface.sol";
import {OracleInterface} from "../interfaces/OracleInterface.sol";
import {AddressBookInterface} from "../interfaces/AddressBookInterface.sol";
import {MarginVault} from "../libs/MarginVault.sol";
import {SafeMath} from "../packages/oz/SafeMath.sol";

/**
 * @title MarginRequirements
 * @author Ribbon Team
 * @notice Contract that defines margin requirements
 */
contract MarginRequirements is Ownable {
    using MarginVault for MarginVault.Vault;
    using SafeMath for uint256;

    OracleInterface public oracle;

    struct MinMaxNotional {
        // minimum notional value allowed
        uint256 min;
        // maximum notional value allowed
        uint256 max;
    }

    /// @notice AddressBook module
    address public addressBook;

    ///@dev mapping between an asset address to a struct consisting of uint256 min, uint256 max which will be its notional floor and cap size allowed
    mapping(address => MinMaxNotional) public minMaxNotional;
    ///@dev mapping between a hash of (underlying asset, collateral asset, isPut) and a mapping of an account to an initial margin value
    mapping(bytes32 => mapping(address => uint256)) public initialMargin;
    ///@dev mapping between an account owner and a mapping of a specific vault id to a maintenance margin value
    mapping(address => mapping(uint256 => uint256)) public maintenanceMargin;

    /**
     * @notice contructor
     * @param _addressBook AddressBook module
     */
    constructor(address _addressBook) public {
        require(_addressBook != address(0), "Invalid address book");

        addressBook = _addressBook;

        oracle = OracleInterface(AddressBookInterface(_addressBook).getOracle());
    }

    /**
     * @notice check if the sender is the Controller module
     */
    modifier onlyController() {
        require(
            msg.sender == AddressBookInterface(addressBook).getController(),
            "MarginRequirements: Sender is not Controller"
        );

        _;
    }

    /**
     * @notice modifier to check if the sender is the Keeper address
     */
    modifier onlyKeeper() {
        require(
            msg.sender == AddressBookInterface(addressBook).getKeeper(),
            "MarginRequirements: Sender is not Keeper"
        );

        _;
    }

    /**
     * @notice sets the initial margin %
     * @dev can only be called by owner
     * @param _underlying underlying asset address
     * @param _collateral collateral asset address
     * @param _isPut option type the vault is selling
     * @param _account account address
     * @param _initialMargin initial margin amount with 18 decimals
     */
    function setInitialMargin(
        address _underlying,
        address _collateral,
        bool _isPut,
        address _account,
        uint256 _initialMargin
    ) external onlyOwner {
        require(_initialMargin > 0, "MarginRequirements: initial margin cannot be 0");
        require(_underlying != address(0), "MarginRequirements: invalid underlying");
        require(_collateral != address(0), "MarginRequirements: invalid collateral");
        require(_account != address(0), "MarginRequirements: invalid account");

        initialMargin[keccak256(abi.encode(_underlying, _collateral, _isPut))][_account] = _initialMargin;
    }

    /**
     * @notice sets the maintenance margin %
     * @dev can only be called by keeper
     * @param _account account address
     * @param _vaultId vault id value
     * @param _maintenanceMargin maintenance margin amount with 18 decimals
     */
    function setMaintenanceMargin(
        address _account,
        uint256 _vaultId,
        uint256 _maintenanceMargin
    ) external onlyKeeper {
        require(_maintenanceMargin > 0, "MarginRequirements: initial margin cannot be 0");
        require(_account != address(0), "MarginRequirements: invalid account");

        maintenanceMargin[_account][_vaultId] = _maintenanceMargin;
    }

    /**
     * @notice sets the floor and cap of a particular asset notional
     * @dev can only be called by owner
     * @param _asset address of the asset
     * @param _min minimum notional value allowed
     * @param _max maximum notional value allowed
     */
    function setMinMaxNotional(
        address _asset,
        uint256 _min,
        uint256 _max
    ) external onlyOwner {
        require(_asset != address(0), "MarginRequirements: invalid asset");
        require(_min > 0, "MarginRequirements: minimum notional cannot be 0");
        require(_max > 0, "MarginRequirements: maximum notional cannot be 0");

        minMaxNotional[_asset].min = _min;
        minMaxNotional[_asset].max = _max;
    }

    /**
     * @notice clears the maintenance margin mapping
     * @dev can only be called by controller
     * @param _account account address
     * @param _vaultId vault id value
     */
    function clearMaintenanceMargin(address _account, uint256 _vaultId) external onlyController {
        delete maintenanceMargin[_account][_vaultId];
    }

    // below is WIP
    /**
     * @notice checks if the notional value is within the allowed notional size
     * @param //TBD
     * @return boolean value stating whether the notional size is allowed
     */
    /*     function checkNotionalSize(
        uint256 currentOtokenBalance,
        uint256 mintAmount,
        address underlying
    ) external view returns (bool) {
        uint256 notionalSize = (currentOtokenBalance.add(mintAmount)).mul(oracle.getPrice(underlying));

        return (notionalSize > minMaxNotional[underlying].min && notionalSize < minMaxNotional[underlying].max);
    } */

    /**
     * @notice checks if there is enough collateral to mint the desired amount of otokens
     * @param //TBD
     * @return boolean value stating whether there is enough collateral to mint
     */
    /*     function checkMintCollateral(
        uint256 index,
        address account,
        uint256 mintAmount,
        MarginVault.Vault memory vault
    ) external view returns (bool) {
        return ((vault.shortAmounts[index].add(mintAmount))
            .mul(oracle.getPrice(OtokenInterface(vault.shortOtokens[index]).underlyingAsset()))
            .mul(_getInitialMargin(vault.shortOtokens[index], account))
            .div(10**18) < vault.collateralAmounts[index]);
    } */

    /**
     * @notice checks if there is enough collateral to withdraw the desired amount
     * @param //TBD
     * @return boolean value stating whether there is enough collateral to withdraw
     */
    /*     function checkWithdrawCollateral(
        address account,
        uint256 index,
        uint256 vaultId,
        uint256 withdrawAmount,
        MarginVault.Vault memory vault
    ) external view returns (bool) {

        return ((vault.shortAmounts[index])
            .mul(oracle.getPrice(OtokenInterface(vault.shortOtokens[index]).underlyingAsset()))
            .mul(_getInitialMargin(vault.shortOtokens[index], account).add(maintenanceMargin[account][vaultId]))
            .div(10**18) < vault.collateralAmounts[index].sub(withdrawAmount));
    } */

    /**
     * @notice returns the initial margin value
     * @param //TBD
     * @return inital margin value
     */
    /*     function _getInitialMargin(address _otoken, address _account) internal view returns (uint256) {
        OtokenInterface otoken = OtokenInterface(_otoken);

        return
            initialMargin[keccak256(abi.encode(otoken.underlyingAsset(), otoken.collateralAsset(), otoken.isPut()))][
                _account
            ];
    } */
}

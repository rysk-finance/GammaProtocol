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
import {ERC20Interface} from "../interfaces/ERC20Interface.sol";

/**
 * @title MarginRequirements
 * @author Ribbon Team
 * @notice Contract that defines margin requirements and operations
 */
contract MarginRequirements is Ownable {
    using MarginVault for MarginVault.Vault;
    using SafeMath for uint256;

    OracleInterface public oracle;

    /************************************************
     *  STORAGE
     ***********************************************/

    /// @notice AddressBook module
    address public addressBook;

    ///@dev mapping between a hash of (underlying asset, collateral asset, isPut) and a mapping of an account to an initial margin value
    mapping(bytes32 => mapping(address => uint256)) internal initialMargin;
    ///@dev mapping between an account owner and a mapping of a specific vault id to a maintenance margin value
    mapping(address => mapping(uint256 => uint256)) internal maintenanceMargin;

    /************************************************
     *  CONSTRUCTOR
     ***********************************************/

    /**
     * @notice constructor
     * @param _addressBook AddressBook address
     */
    constructor(address _addressBook) public {
        require(_addressBook != address(0), "Invalid address book");

        addressBook = _addressBook;

        oracle = OracleInterface(AddressBookInterface(_addressBook).getOracle());
    }

    /**
     * @notice modifier to check if the sender is the OTC wrapper module
     */
    modifier onlyOTCWrapper() {
        require(
            msg.sender == AddressBookInterface(addressBook).getOTCWrapper(),
            "MarginRequirements: Sender is not OTCWrapper"
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

    /************************************************
     *  SETTERS
     ***********************************************/

    /**
     * @notice sets the initial margin %
     * @dev can only be called by owner
     * @param _underlying underlying asset address
     * @param _collateralAsset collateral asset address
     * @param _isPut option type the vault is selling
     * @param _account account address
     * @param _initialMargin initial margin percentage (eg. 10% = 1000)
     */
    function setInitialMargin(
        address _underlying,
        address _collateralAsset,
        bool _isPut,
        address _account,
        uint256 _initialMargin
    ) external onlyOwner {
        require(
            _initialMargin > 0 && _initialMargin <= 100 * 10**2,
            "MarginRequirements: initial margin cannot be 0 or higher than 100%"
        );
        require(_underlying != address(0), "MarginRequirements: invalid underlying");
        require(_collateralAsset != address(0), "MarginRequirements: invalid collateral");
        require(_account != address(0), "MarginRequirements: invalid account");

        initialMargin[keccak256(abi.encode(_underlying, _collateralAsset, _isPut))][_account] = _initialMargin;
    }

    /**
     * @notice sets the maintenance margin absolute amount
     * @dev can only be called by keeper
     * @param _account account address
     * @param _vaultID id of the vault
     * @param _maintenanceMargin maintenance margin absolute amount
     */
    function setMaintenanceMargin(
        address _account,
        uint256 _vaultID,
        uint256 _maintenanceMargin
    ) external onlyKeeper {
        require(_maintenanceMargin > 0, "MarginRequirements: initial margin cannot be 0");
        require(_account != address(0), "MarginRequirements: invalid account");

        maintenanceMargin[_account][_vaultID] = _maintenanceMargin;
    }

    /************************************************
     *  MARGIN OPERATIONS
     ***********************************************/

    /**
     * @notice clears the maintenance margin mapping
     * @dev can only be called by OTC wrapper contract
     * @param _account account address
     * @param _vaultID id of the vault
     */
    function clearMaintenanceMargin(address _account, uint256 _vaultID) external onlyOTCWrapper {
        delete maintenanceMargin[_account][_vaultID];
    }

    /**
     * @notice checks if there is enough collateral to mint the desired amount of otokens
     * @param _account account address
     * @param _notional order notional amount
     * @param _underlying underlying asset address
     * @param _isPut option type the vault is selling
     * @param _collateralAsset collateral asset address
     * @param _collateralAmount collateral amount
     * @return boolean value stating whether there is enough collateral to mint
     */
    function checkMintCollateral(
        address _account,
        uint256 _notional,
        address _underlying,
        bool _isPut,
        uint256 _collateralAmount,
        address _collateralAsset
    ) external view returns (bool) {
        uint256 collateralDecimals = uint256(ERC20Interface(_collateralAsset).decimals());

        uint256 initialMarginRequired = initialMargin[keccak256(abi.encode(_underlying, _collateralAsset, _isPut))][
            _account
        ];

        return
            _notional.mul(initialMarginRequired).mul(10**collateralDecimals).mul(10e8) <
            _collateralAmount.mul(oracle.getPrice(_collateralAsset)).mul(100e2).mul(10e6);
    }

    /**
     * @notice checks if there is enough collateral to withdraw the desired amount
     * @param _account account address
     * @param _withdrawAmount desired amount to withdraw
     * @param _otokenAddress otoken address
     * @param _underlying underlying asset address
     * @param _vaultID id of the vault
     * @param _vault vault struct
     * @return boolean value stating whether there is enough collateral to withdraw
     */
    function checkWithdrawCollateral(
        address _account,
        uint256 _withdrawAmount,
        address _otokenAddress,
        address _underlying,
        uint256 _vaultID,
        MarginVault.Vault memory _vault
    ) external view returns (bool) {
        uint256 collateralDecimals = uint256(ERC20Interface(_vault.collateralAssets[0]).decimals());

        return
            _vault
                .shortAmounts[0]
                .mul(oracle.getPrice(_underlying))
                .mul(_getInitialMargin(_otokenAddress, _account))
                .mul(10**collateralDecimals) <
            (_vault.collateralAmounts[0].sub(_withdrawAmount).sub(_getMaintenanceMargin(_account, _vaultID)))
                .mul(oracle.getPrice(_vault.collateralAssets[0]))
                .mul(100e2)
                .mul(1e8);
    }

    /**
     * @notice returns the initial margin value (avoids stack too deep)
     * @param _otoken otoken address
     * @param _account account address
     * @return inital margin value
     */
    function _getInitialMargin(address _otoken, address _account) internal view returns (uint256) {
        OtokenInterface otoken = OtokenInterface(_otoken);

        return
            initialMargin[keccak256(abi.encode(otoken.underlyingAsset(), otoken.collateralAsset(), otoken.isPut()))][
                _account
            ];
    }

    /**
     * @notice returns the maintenance margin value (avoids stack too deep)
     * @param _account account address
     * @param _vaultID id of the vault
     * @return maintenance margin value
     */
    function _getMaintenanceMargin(address _account, uint256 _vaultID) internal view returns (uint256) {
        return maintenanceMargin[_account][_vaultID];
    }
}

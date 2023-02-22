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
 * @notice Contract that defines margin requirements
 */
contract MarginRequirements is Ownable {
    using MarginVault for MarginVault.Vault;
    using SafeMath for uint256;

    OracleInterface public oracle;

    /// @notice AddressBook module
    address public addressBook;

    ///@dev mapping between a hash of (underlying asset, collateral asset, isPut) and a mapping of an account to an initial margin value
    mapping(bytes32 => mapping(address => uint256)) public initialMargin;
    ///@dev mapping between an account owner and a mapping of a specific vault id to a maintenance margin value
    mapping(address => mapping(uint256 => uint256)) public maintenanceMargin;

    /**
     * @notice constructor
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
     * @notice clears the maintenance margin mapping
     * @dev can only be called by controller
     * @param _account account address
     * @param _vaultId vault id value
     */
    function clearMaintenanceMargin(address _account, uint256 _vaultId) external onlyController {
        delete maintenanceMargin[_account][_vaultId];
    }

    /**
     * @notice checks if there is enough collateral to mint the desired amount of otokens
     * @param _account account address
     * @param _mintAmount desired amount of otokens to mint
     * @param _otokenAddress otoken address
     * @param _otokenStock stock amount of otokens already minted
     * @param _underlying address of underlying asset
     * @param _vault vault struct
     * @return boolean value stating whether there is enough collateral to mint
     */
    function checkMintCollateral(
        address _account,
        uint256 _mintAmount,
        address _otokenAddress,
        uint256 _otokenStock,
        address _underlying,
        MarginVault.Vault memory _vault
    ) external view returns (bool) {
        uint256 collateralDecimals = uint256(ERC20Interface(_vault.collateralAssets[0]).decimals());

        return ((_otokenStock.add(_mintAmount)).mul(oracle.getPrice(_underlying)).mul(
            _getInitialMargin(_otokenAddress, _account).mul(10**collateralDecimals)
        ) < _vault.collateralAmounts[0].mul(oracle.getPrice(_vault.collateralAssets[0])).mul(100e18).mul(1e8));
    }

    /**
     * @notice checks if there is enough collateral to withdraw the desired amount
     * @param _account account address
     * @param _withdrawAmount desired amount of otokens to withdraw
     * @param _otokenAddress otoken address
     * @param _underlying address of underlying asset
     * @param _vaultId id of the vault
     * @param _vault vault struct
     * @return boolean value stating whether there is enough collateral to withdraw
     */
    function checkWithdrawCollateral(
        address _account,
        uint256 _withdrawAmount,
        address _otokenAddress,
        address _underlying,
        uint256 _vaultId,
        MarginVault.Vault memory _vault
    ) external view returns (bool) {
        uint256 collateralDecimals = uint256(ERC20Interface(_vault.collateralAssets[0]).decimals());

        return (_vault
            .shortAmounts[0]
            .mul(oracle.getPrice(_underlying))
            .mul((_getInitialMargin(_otokenAddress, _account).add(maintenanceMargin[_account][_vaultId])))
            .mul(10**collateralDecimals) <
            (_vault.collateralAmounts[0].sub(_withdrawAmount))
                .mul(oracle.getPrice(_vault.collateralAssets[0]))
                .mul(100e18)
                .mul(1e8));
    }

    /**
     * @notice returns the initial margin value
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
}

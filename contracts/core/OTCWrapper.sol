/**
 * SPDX-License-Identifier: UNLICENSED
 */
pragma solidity 0.8.10;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {ERC2771ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";
import {MarginRequirementsWrapperInterface} from "../interfaces/otcWrapperInterfaces/MarginRequirementsWrapperInterface.sol";
import {ControllerWrapperInterface} from "../interfaces/otcWrapperInterfaces/ControllerWrapperInterface.sol";
import {AddressBookWrapperInterface} from "../interfaces/otcWrapperInterfaces/AddressBookWrapperInterface.sol";
import {WhitelistWrapperInterface} from "../interfaces/otcWrapperInterfaces/WhitelistWrapperInterface.sol";
import {UtilsWrapperInterface} from "../interfaces/otcWrapperInterfaces/UtilsWrapperInterface.sol";
import {OracleWrapperInterface} from "../interfaces/otcWrapperInterfaces/OracleWrapperInterface.sol";
import {IOtokenFactoryWrapperInterface} from "../interfaces/otcWrapperInterfaces/IOtokenFactoryWrapperInterface.sol";
import {MinimalForwarder} from "@openzeppelin/contracts/metatx/MinimalForwarder.sol";
import {SupportsNonCompliantERC20} from "../libs/SupportsNonCompliantERC20.sol";

/**
 * @title OTC Wrapper
 * @author Ribbon Team
 * @notice Contract that overlays Gamma Protocol for the OTC related interactions
 */
contract OTCWrapper is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, ERC2771ContextUpgradeable {
    using SafeERC20 for IERC20;
    using SupportsNonCompliantERC20 for IERC20;
    using SafeMath for uint256;

    AddressBookWrapperInterface public addressbook;
    MarginRequirementsWrapperInterface public marginRequirements;
    ControllerWrapperInterface public controller;
    OracleWrapperInterface public oracle;
    WhitelistWrapperInterface public whitelist;
    IOtokenFactoryWrapperInterface public OTokenFactory;

    /************************************************
     *  EVENTS
     ***********************************************/

    /// @notice emits an event when an order is placed
    event OrderPlaced(
        uint256 indexed orderID,
        address indexed underlyingAsset,
        bool isPut,
        uint256 strikePrice,
        uint256 expiry,
        uint256 premium,
        uint256 notional,
        address indexed buyer
    );

    /// @notice emits an event when an order is canceled
    event OrderCancelled(uint256 orderID);

    /// @notice emits an event when an order is executed
    event OrderExecuted(
        uint256 indexed orderID,
        address collateralAsset,
        uint256 premium,
        address indexed seller,
        uint256 indexed vaultID,
        address oToken,
        uint256 initialMargin
    );

    /// @notice emits an event when collateral is deposited
    event CollateralDeposited(uint256 indexed orderID, uint256 amount, address indexed acct);

    /// @notice emits an event when collateral is withdrawn
    event CollateralWithdrawn(uint256 indexed orderID, uint256 amount, address indexed acct);

    /// @notice emits an event when a vault is settled
    event VaultSettled(uint256 indexed orderID);

    /************************************************
     *  STORAGE
     ***********************************************/

    ///@notice order counter
    uint256 public latestOrder;

    ///@notice fill deadline duration in seconds
    uint256 public fillDeadline;

    ///@notice address that will receive the product fees
    address public beneficiary;

    /// @notice USDC 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
    address public immutable USDC;

    // order status
    enum OrderStatus {
        Failed,
        Pending,
        Succeeded
    }

    // struct defining order details
    struct Order {
        // underlying asset address (with its respective token decimals)
        address underlying;
        // collateral asset address (with its respective token decimals)
        address collateral;
        // option type the vault is selling
        bool isPut;
        // option strike price
        uint256 strikePrice;
        // option expiry timestamp
        uint256 expiry;
        // order premium amount in USDC (with USDC decimals)
        uint256 premium;
        // order notional in USD (with 6 decimals)
        uint256 notional;
        // buyer address
        address buyer;
        // seller address
        address seller;
        // id of the vault
        uint256 vaultID;
        // otoken address (with 8 decimals)
        address oToken;
        // timestamp of when the order was opened
        uint256 openedAt;
    }

    // struct defining permit signature details
    struct Permit {
        // permit amount (with its respective token decimals)
        uint256 amount;
        // permit deadline
        uint256 deadline;
        // permit account
        address acct;
        // v component of permit signature
        uint8 v;
        // r component of permit signature
        bytes32 r;
        // s component of permit signature
        bytes32 s;
    }

    // struct defining the upper and lower boundaries of USD notional for an asset
    struct MinMaxNotional {
        // minimum USD notional value allowed (with 6 decimals)
        uint256 min;
        // maximum USD notional value allowed (with 6 decimals)
        uint256 max;
    }

    ///@dev mapping between an asset address to a struct consisting of uint256 min and a uint256 max which will be its notional floor and cap allowed
    mapping(address => MinMaxNotional) public minMaxNotional;

    ///@notice mapping between order id and order details
    mapping(uint256 => Order) public orders;

    ///@notice mapping between order id and order status
    mapping(uint256 => OrderStatus) public orderStatus;

    ///@notice mapping between a Market Maker address and its whitelist status
    mapping(address => bool) public isWhitelistedMarketMaker;

    ///@notice mapping between an asset address and its corresponding fee
    mapping(address => uint256) public fee;

    ///@notice mapping between acct and list of all successful orders
    mapping(address => uint256[]) public ordersByAcct;

    /************************************************
     *  CONSTRUCTOR & INITIALIZATION
     ***********************************************/

    /**
     * @notice constructor related to ERC2771
     * @param _trustedForwarder trusted forwarder address
     * @param _usdc USDC address
     */
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(MinimalForwarder _trustedForwarder, address _usdc)
        ERC2771ContextUpgradeable(address(_trustedForwarder))
    {
        require(_usdc != address(0), "OTCWrapper: usdc address cannot be 0");

        USDC = _usdc;
    }

    /**
     * @notice initialize the deployed contract
     * @param _beneficiary beneficiary address
     * @param _addressBook AddressBook address
     * @param _fillDeadline fill deadline duration in seconds
     */
    function initialize(
        address _addressBook,
        address _beneficiary,
        uint256 _fillDeadline
    ) external initializer {
        require(_addressBook != address(0), "OTCWrapper: addressbook address cannot be 0");
        require(_beneficiary != address(0), "OTCWrapper: beneficiary address cannot be 0");
        require(_fillDeadline > 0, "OTCWrapper: fill deadline cannot be 0");

        __Ownable_init();
        __ReentrancyGuard_init();

        addressbook = AddressBookWrapperInterface(_addressBook);
        marginRequirements = MarginRequirementsWrapperInterface(addressbook.getMarginRequirements());
        controller = ControllerWrapperInterface(addressbook.getController());
        oracle = OracleWrapperInterface(addressbook.getOracle());
        whitelist = WhitelistWrapperInterface(addressbook.getWhitelist());
        OTokenFactory = IOtokenFactoryWrapperInterface(addressbook.getOtokenFactory());

        beneficiary = _beneficiary;
        fillDeadline = _fillDeadline;
    }

    /************************************************
     *  SETTERS
     ***********************************************/

    /**
     * @notice sets the floor and cap of a particular asset notional
     * @dev can only be called by owner
     * @param _underlying underlying asset address
     * @param _min minimum USD notional value allowed (with 6 decimals)
     * @param _max maximum USD notional value allowed (with 6 decimals)
     */
    function setMinMaxNotional(
        address _underlying,
        uint256 _min,
        uint256 _max
    ) external onlyOwner {
        require(_underlying != address(0), "OTCWrapper: asset address cannot be 0");
        require(_min > 0, "OTCWrapper: minimum notional cannot be 0");
        require(_max > 0, "OTCWrapper: maximum notional cannot be 0");

        minMaxNotional[_underlying] = MinMaxNotional(_min, _max);
    }

    /**
     * @notice sets the whitelist status of market maker addresses
     * @dev can only be called by owner
     * @param _marketMakerAddress address of the market maker
     * @param _isWhitelisted bool with whitelist status
     */
    function setWhitelistMarketMaker(address _marketMakerAddress, bool _isWhitelisted) external onlyOwner {
        require(_marketMakerAddress != address(0), "OTCWrapper: market maker address cannot be 0");

        isWhitelistedMarketMaker[_marketMakerAddress] = _isWhitelisted;
    }

    /**
     * @notice sets the fee for a given the underlying asset
     * @dev can only be called by owner
     * @param _underlying underlying asset address
     * @param _fee fee amount in bps with 2 decimals (400 = 4bps = 0.04%)
     */
    function setFee(address _underlying, uint256 _fee) external onlyOwner {
        require(_underlying != address(0), "OTCWrapper: asset address cannot be 0");

        fee[_underlying] = _fee;
    }

    /**
     * @notice sets the beneficiary address
     * @dev can only be called by owner
     * @param _beneficiary beneficiary address
     */
    function setBeneficiary(address _beneficiary) external onlyOwner {
        require(_beneficiary != address(0), "OTCWrapper: beneficiary address cannot be 0");

        beneficiary = _beneficiary;
    }

    /**
     * @notice sets the fill deadline duration
     * @dev can only be called by owner
     * @param _fillDeadline fill deadline duration in seconds
     */
    function setFillDeadline(uint256 _fillDeadline) external onlyOwner {
        require(_fillDeadline > 0, "OTCWrapper: fill deadline cannot be 0");

        fillDeadline = _fillDeadline;
    }

    /************************************************
     *  DEPOSIT & WITHDRAWALS
     ***********************************************/

    /**
     * @notice allows market maker to deposit collateral
     * @dev can only be called by the market maker who is the order seller
     * @param _orderID id of the order
     * @param _amount amount to deposit (with its respective token decimals)
     * @param _mmSignature market maker permit signature
     */
    function depositCollateral(
        uint256 _orderID,
        uint256 _amount,
        Permit calldata _mmSignature
    ) external nonReentrant {
        require(orderStatus[_orderID] == OrderStatus.Succeeded, "OTCWrapper: inexistent or unsuccessful order");
        require(_mmSignature.acct == _msgSender(), "OTCWrapper: signer is not the market maker");

        Order memory order = orders[_orderID];

        require(order.seller == _msgSender(), "OTCWrapper: sender is not the order seller");

        _deposit(
            _mmSignature.acct,
            order.collateral,
            _amount,
            _mmSignature.deadline,
            _mmSignature.v,
            _mmSignature.r,
            _mmSignature.s
        );

        // approve margin pool to deposit collateral
        IERC20(order.collateral).safeApproveNonCompliant(addressbook.getMarginPool(), _amount);

        UtilsWrapperInterface.ActionArgs[] memory actions = new UtilsWrapperInterface.ActionArgs[](1);

        actions[0] = UtilsWrapperInterface.ActionArgs(
            UtilsWrapperInterface.ActionType.DepositCollateral,
            address(this), // owner
            address(this), // address to transfer from
            order.collateral, // deposited asset
            order.vaultID, // vaultId
            _amount, // amount
            0, //index
            "" //data
        );

        // execute actions
        controller.operate(actions);

        emit CollateralDeposited(_orderID, _amount, order.seller);
    }

    /**
     * @notice allows market maker to withdraw collateral
     * @dev can only be called by the market maker who is the order seller
     * @param _orderID id of the order
     * @param _amount amount to withdraw (with its respective token decimals)
     */
    function withdrawCollateral(uint256 _orderID, uint256 _amount) external nonReentrant {
        require(orderStatus[_orderID] == OrderStatus.Succeeded, "OTCWrapper: inexistent or unsuccessful order");

        Order memory order = orders[_orderID];

        require(order.seller == _msgSender(), "OTCWrapper: sender is not the order seller");

        (UtilsWrapperInterface.Vault memory vault, , ) = controller.getVaultWithDetails(address(this), order.vaultID);

        require(
            marginRequirements.checkWithdrawCollateral(
                order.seller,
                order.notional,
                _amount,
                order.oToken,
                order.vaultID,
                vault
            ),
            "OTCWrapper: insufficient collateral"
        );

        UtilsWrapperInterface.ActionArgs[] memory actions = new UtilsWrapperInterface.ActionArgs[](1);

        actions[0] = UtilsWrapperInterface.ActionArgs(
            UtilsWrapperInterface.ActionType.WithdrawCollateral,
            address(this), // owner
            order.seller, // address to transfer to
            order.collateral, // withdrawn asset
            order.vaultID, // vaultId
            _amount, // amount
            0, //index
            "" //data
        );

        // execute actions
        controller.operate(actions);

        emit CollateralWithdrawn(_orderID, _amount, order.seller);
    }

    /**
     * @notice Deposits the `asset` from _msgSender() without an approve
     * `v`, `r` and `s` must be a valid `secp256k1` signature from `owner`
     * over the EIP712-formatted function arguments
     * @param _acct signer account
     * @param _asset is the asset address to deposit
     * @param _amount is the amount to deposit (with its respective token decimals)
     * @param _deadline must be a timestamp in the future
     * @param _v is a valid signature
     * @param _r is a valid signature
     * @param _s is a valid signature
     */
    function _deposit(
        address _acct,
        address _asset,
        uint256 _amount,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) private {
        require(_amount > 0, "OTCWrapper: amount cannot be 0");

        if (_asset == USDC) {
            // Sign for transfer approval
            IERC20Permit(USDC).permit(_acct, address(this), _amount, _deadline, _v, _r, _s);
        }

        // An approve() or permit() by the _msgSender() is required beforehand
        IERC20(_asset).safeTransferFrom(_acct, address(this), _amount);
    }

    /************************************************
     *  OTC OPERATIONS
     ***********************************************/

    /**
     * @notice places an order
     * @param _underlying underlying asset address
     * @param _isPut option type the vault is selling
     * @param _strikePrice option strike price (with its respective token decimals)
     * @param _expiry option expiry timestamp
     * @param _premium order premium amount (USDC value with USDC decimals)
     * @param _notional order notional (USD value with 6 decimals)
     */
    function placeOrder(
        address _underlying,
        bool _isPut,
        uint256 _strikePrice,
        uint256 _expiry,
        uint256 _premium,
        uint256 _notional
    ) external {
        require(
            _notional > minMaxNotional[_underlying].min && _notional < minMaxNotional[_underlying].max,
            "OTCWrapper: invalid notional value"
        );
        require(_expiry > block.timestamp, "OTCWrapper: expiry must be in the future");

        latestOrder += 1;

        orders[latestOrder] = Order(
            _underlying,
            address(0),
            _isPut,
            _strikePrice,
            _expiry,
            _premium,
            _notional,
            _msgSender(),
            address(0),
            0,
            address(0),
            block.timestamp
        );

        ordersByAcct[_msgSender()].push(latestOrder);

        orderStatus[latestOrder] = OrderStatus.Pending;

        emit OrderPlaced(latestOrder, _underlying, _isPut, _strikePrice, _expiry, _premium, _notional, _msgSender());
    }

    /**
     * @notice cancels an order
     * @param _orderID order id
     */
    function undoOrder(uint256 _orderID) external {
        require(orderStatus[_orderID] == OrderStatus.Pending, "OTCWrapper: inexistent or unsuccessful order");
        require(orders[_orderID].buyer == _msgSender(), "OTCWrapper: only buyer can undo the order");

        orderStatus[_orderID] = OrderStatus.Failed;

        emit OrderCancelled(_orderID);
    }

    /**
     * @notice executes an order
     * @dev can only be called by whitelisted market makers
     *      requires that product and collateral have already been whitelisted beforehand
     *      ensure that initial margin has been set up beforehand
     *      ensure collateral naked cap from Controller.sol is high enough for the additional collateral
     *      ensure setUpperBoundValues and setSpotShock from MarginCalculator.sol have been set up
     * @param _orderID id of the order
     * @param _userSignature user permit signature
     * @param _mmSignature market maker permit signature
     * @param _premium order premium amount (USDC value with USDC decimals)
     * @param _collateralAsset collateral asset address
     * @param _collateralAmount collateral amount (with its respective token decimals)
     */
    function executeOrder(
        uint256 _orderID,
        Permit calldata _userSignature,
        Permit calldata _mmSignature,
        uint256 _premium,
        address _collateralAsset,
        uint256 _collateralAmount
    ) external nonReentrant {
        require(orderStatus[_orderID] == OrderStatus.Pending, "OTCWrapper: inexistent or unsuccessful order");
        require(isWhitelistedMarketMaker[_msgSender()], "OTCWrapper: address not whitelisted marketmaker");
        require(_userSignature.amount >= _premium, "OTCWrapper: insufficient amount");

        Order memory order = orders[_orderID];

        require(_userSignature.acct == order.buyer, "OTCWrapper: signer is not the buyer");
        require(_mmSignature.acct == _msgSender(), "OTCWrapper: signer is not the market maker");
        require(block.timestamp <= order.openedAt.add(fillDeadline), "OTCWrapper: deadline has passed");
        require(whitelist.isWhitelistedCollateral(_collateralAsset), "OTCWrapper: collateral is not whitelisted");

        require(
            marginRequirements.checkMintCollateral(
                _msgSender(),
                order.notional,
                order.underlying,
                order.isPut,
                _collateralAmount,
                _collateralAsset
            ),
            "OTCWrapper: insufficient collateral"
        );

        // settle funds
        _settleFunds(order, _userSignature, _mmSignature, _premium, _collateralAsset, _collateralAmount);

        // deposit collateral and mint otokens
        (uint256 vaultID, address oToken) = _depositCollateralAndMint(order, _collateralAsset, _collateralAmount);

        // order accounting
        orders[_orderID].premium = _premium;
        orders[_orderID].collateral = _collateralAsset;
        orders[_orderID].seller = _msgSender();
        orders[_orderID].vaultID = vaultID;
        orders[_orderID].oToken = oToken;
        orderStatus[_orderID] = OrderStatus.Succeeded;
        ordersByAcct[_msgSender()].push(_orderID);

        emit OrderExecuted(_orderID, _collateralAsset, _premium, _msgSender(), vaultID, oToken, _collateralAmount);
    }

    /**
     * @notice both parties deposit, the fee is transferred to beneficiary and premium is transferred to market maker
     * @param _order order struct with order details
     * @param _userSignature user permit signature
     * @param _mmSignature market maker permit signature
     * @param _premium order premium amount (USDC value with USDC decimals)
     * @param _collateralAsset collateral asset address
     * @param _collateralAmount collateral amount (with its respective token decimals)
     */
    function _settleFunds(
        Order memory _order,
        Permit calldata _userSignature,
        Permit calldata _mmSignature,
        uint256 _premium,
        address _collateralAsset,
        uint256 _collateralAmount
    ) private {
        // user inflow
        _deposit(
            _userSignature.acct,
            USDC,
            _premium,
            _userSignature.deadline,
            _userSignature.v,
            _userSignature.r,
            _userSignature.s
        );

        // market maker inflow
        _deposit(
            _mmSignature.acct,
            _collateralAsset,
            _collateralAmount,
            _mmSignature.deadline,
            _mmSignature.v,
            _mmSignature.r,
            _mmSignature.s
        );

        // eg. fee = 4bps = 0.04% , then need to divide by 100 again so (( 4 / 100 ) / 100)
        // after the above it is divided again by 1e2 which is the fee decimals
        // when aggregated the division becomes by 1e6
        uint256 orderFee = (_order.notional.mul(fee[_order.underlying])).div(1e6);

        // transfer fee to beneficiary address
        IERC20(USDC).safeTransfer(beneficiary, orderFee);

        // transfer premium to market maker
        IERC20(USDC).safeTransfer(_msgSender(), _premium.sub(orderFee));
    }

    /**
     * @notice deposits collateral and mints otokens
     * @param _order order struct with order details
     * @param _collateralAsset collateral asset address
     * @param _collateralAmount collateral amount (with its respective token decimals)
     * @return vault id and otoken address
     */
    function _depositCollateralAndMint(
        Order memory _order,
        address _collateralAsset,
        uint256 _collateralAmount
    ) private returns (uint256, address) {
        // open vault
        uint256 vaultID = (controller.getAccountVaultCounter(address(this))).add(1);

        UtilsWrapperInterface.ActionArgs[] memory actions = new UtilsWrapperInterface.ActionArgs[](3);

        actions[0] = UtilsWrapperInterface.ActionArgs(
            UtilsWrapperInterface.ActionType.OpenVault,
            address(this), // owner
            address(this), // receiver
            address(0), // asset, otoken
            vaultID, // vaultId
            0, // amount
            0, // index
            abi.encode(1) // vault type
        );

        // Approve margin pool to deposit collateral
        IERC20(_collateralAsset).safeApproveNonCompliant(addressbook.getMarginPool(), _collateralAmount);

        // deposit collateral
        actions[1] = UtilsWrapperInterface.ActionArgs(
            UtilsWrapperInterface.ActionType.DepositCollateral,
            address(this), // owner
            address(this), // address to transfer from
            _collateralAsset, // deposited asset
            vaultID, // vaultId
            _collateralAmount, // amount
            0, //index
            "" //data
        );

        // retrieve otoken address
        address oToken = _getOrDeployOToken(_order, _collateralAsset);

        // scales by 1e8 for division with oracle price
        // scales by 1e2 to increase from 6 decimals (notional) to 8 decimals (otoken)
        uint256 mintAmount = _order.notional.mul(1e10).div(oracle.getPrice(_order.underlying));

        // mint otokens
        actions[2] = UtilsWrapperInterface.ActionArgs(
            UtilsWrapperInterface.ActionType.MintShortOption,
            address(this), // owner
            _order.buyer, // address to transfer to
            oToken, // option address
            vaultID, // vaultId
            mintAmount, // amount
            0, // index
            "" // data
        );

        // execute actions
        controller.operate(actions);

        return (vaultID, oToken);
    }

    /**
     * @notice checks if oToken exists, if not then deploys a new one
     * @param _order order struct with order details
     * @param _collateralAsset collateral asset address
     * @return otoken address
     */
    function _getOrDeployOToken(Order memory _order, address _collateralAsset) private returns (address) {
        address oToken = OTokenFactory.getOtoken(
            _order.underlying,
            USDC,
            _collateralAsset,
            _order.strikePrice,
            _order.expiry,
            _order.isPut
        );

        if (oToken == address(0)) {
            oToken = OTokenFactory.createOtoken(
                _order.underlying,
                USDC,
                _collateralAsset,
                _order.strikePrice,
                _order.expiry,
                _order.isPut
            );
        }

        return oToken;
    }

    /**
     * @notice settles the vault after expiry
     * @dev can only be called by the market maker who is the order seller
     * @param _orderID order id
     */
    function settleVault(uint256 _orderID) external nonReentrant {
        require(orderStatus[_orderID] == OrderStatus.Succeeded, "OTCWrapper: inexistent or unsuccessful order");

        Order memory order = orders[_orderID];

        require(order.seller == _msgSender(), "OTCWrapper: sender is not the order seller");

        UtilsWrapperInterface.ActionArgs[] memory actions = new UtilsWrapperInterface.ActionArgs[](1);

        actions[0] = UtilsWrapperInterface.ActionArgs(
            UtilsWrapperInterface.ActionType.SettleVault,
            address(this), // owner
            order.seller, // address to transfer to
            address(0), // not used
            order.vaultID, // vaultId
            0, // not used
            0, // not used
            "" // not used
        );

        // execute actions
        controller.operate(actions);

        emit VaultSettled(_orderID);
    }

    /************************************************
     *  MISCELLANEOUS
     ***********************************************/

    /**
     * @dev overrides _msgSender() related to ERC2771
     */
    function _msgSender()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address sender)
    {
        return ERC2771ContextUpgradeable._msgSender();
    }

    /**
     * @dev overrides _msgData() related to ERC2771
     */
    function _msgData()
        internal
        view
        virtual
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (bytes calldata)
    {
        return ERC2771ContextUpgradeable._msgData();
    }
}

// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.6.10;
pragma experimental ABIEncoderV2;

import {Test, console} from 'forge-std/Test.sol';

import {AddressBook} from 'contracts/core/AddressBook.sol';
import {OtokenFactory} from 'contracts/core/OtokenFactory.sol';
import {Otoken} from 'contracts/core/Otoken.sol';
import {Whitelist} from 'contracts/core/Whitelist.sol';
import {Oracle} from 'contracts/core/Oracle.sol';
import {MarginPool} from 'contracts/core/MarginPool.sol';
import {MarginCalculator} from 'contracts/core/MarginCalculator.sol';
import {MarginVault} from 'contracts/libs/MarginVault.sol';
import {Controller} from 'contracts/core/Controller.sol';
import {MockERC20} from 'contracts/mocks/MockERC20.sol';

contract Base_Test is Test {
  struct Users {
    // Default admin
    address payable gov;
    // Impartial user.
    address payable alice;
    // Second user
    address payable dan;
    // liquidator user
    address payable larry;
    // Malicious user.
    address payable hackerman;
    // Manager
    address payable manager;
    // Operator
    address payable operator;
  }

  Users internal users;

  address ZERO_ADDRESS = address(0x0);
  uint256 internal fridayExpiration = 1737705600; // Friday 25 Jan 2025, 8am UTC

  /*//////////////////////////////////////////////////////////////////////////
                                   TEST CONTRACTS
    //////////////////////////////////////////////////////////////////////////*/

  MockERC20 internal usdc;
  MockERC20 internal weth;
  MockERC20 internal wsteth;
  MockERC20 internal wbtc;
  MockERC20 internal solvbtc;
  MockERC20 internal lbtc;
  AddressBook internal addressBook;
  OtokenFactory internal otokenFactory;
  Otoken internal otokenImpl;
  Whitelist internal whitelist;
  Oracle internal oracle;
  MarginPool internal marginPool;
  MarginCalculator internal marginCalculator;
  Controller internal controller;
  Controller internal controllerImpl;

  /*//////////////////////////////////////////////////////////////////////////
                                  SET-UP FUNCTION
    //////////////////////////////////////////////////////////////////////////*/

  function setUp() public virtual {
    // Deploy the base test contracts.
    usdc = new MockERC20('USDC Stablecoin', 'USDC', 6);
    weth = new MockERC20('WETH', 'WETH', 18);
    wsteth = new MockERC20('Wrapped Staked Ether', 'wstETH', 18);
    wbtc = new MockERC20('Wrapped BTC', 'WBTC', 8);
    solvbtc = new MockERC20('Solv BTC', 'SolvBTC', 18);
    lbtc = new MockERC20('Lombard BTC', 'LBTC', 8);

    // Create users for testing.
    users = Users({
      gov: createUser('gov'),
      alice: createUser('alice'),
      dan: createUser('dan'),
      larry: createUser('larry'), // liquidatoooor
      hackerman: createUser('hackerman'),
      manager: createUser('manager'),
      operator: createUser('operator')
    });

    usdc.mint(users.gov, 1e20);
    weth.mint(users.gov, 1e32);
    wsteth.mint(users.gov, 1e32);
    wbtc.mint(users.gov, 1e10);
    solvbtc.mint(users.gov, 1e20);
    lbtc.mint(users.gov, 1e10);
    usdc.mint(users.alice, 1000e6);
    weth.mint(users.alice, 10e18);
    wsteth.mint(users.alice, 1e32);
    wbtc.mint(users.alice, 1e10);
    solvbtc.mint(users.alice, 1e20);
    lbtc.mint(users.alice, 1e10);
    usdc.mint(users.hackerman, 1000e6);
    weth.mint(users.hackerman, 10e18);
    wsteth.mint(users.hackerman, 1e32);
    wbtc.mint(users.hackerman, 1e10);
    solvbtc.mint(users.hackerman, 1e20);
    lbtc.mint(users.hackerman, 1e10);
    usdc.mint(users.manager, 1000e6);
    weth.mint(users.manager, 10e18);
    wsteth.mint(users.manager, 1e32);
    wbtc.mint(users.manager, 1e10);
    solvbtc.mint(users.manager, 1e20);
    lbtc.mint(users.manager, 1e10);
    usdc.mint(users.operator, 1000e6);
    weth.mint(users.operator, 10e18);
    wsteth.mint(users.operator, 1e32);
    wbtc.mint(users.operator, 1e10);
    solvbtc.mint(users.operator, 1e20);
    lbtc.mint(users.operator, 1e10);

    // Warp to Jan 1, 2025 at 00:00 GMT to provide a more consistent testing environment.
    vm.warp(1735689600);
  }

  function deploySystem() public {
    vm.startPrank(users.gov);
    addressBook = new AddressBook();

    otokenFactory = new OtokenFactory(address(addressBook));
    addressBook.setOtokenFactory(address(otokenFactory));

    otokenImpl = new Otoken();
    addressBook.setOtokenImpl(address(otokenImpl));

    whitelist = new Whitelist(address(addressBook));
    addressBook.setWhitelist(address(whitelist));

    oracle = new Oracle();

    addressBook.setOracle(address(oracle));

    marginPool = new MarginPool(address(addressBook));
    addressBook.setMarginPool(address(marginPool));

    marginCalculator = new MarginCalculator(address(oracle), address(addressBook));
    addressBook.setMarginCalculator(address(marginCalculator));

    controllerImpl = new Controller();
    addressBook.setController(address(controllerImpl));
    controllerImpl.initialize(address(addressBook), users.gov, users.gov); // set manager to owner for now
    controllerImpl.refreshConfiguration();
    controller = Controller(addressBook.getController());
    controller.setManager(users.manager);

    whitelist.whitelistCollateral(address(weth));
    whitelist.whitelistCollateral(address(wsteth));
    whitelist.whitelistCollateral(address(solvbtc));
    whitelist.whitelistCollateral(address(lbtc));

    whitelist.whitelistProduct(address(weth), address(usdc), address(weth), false);
    whitelist.whitelistProduct(address(weth), address(usdc), address(wsteth), false);
    whitelist.whitelistProduct(address(wbtc), address(usdc), address(solvbtc), false);
    whitelist.whitelistProduct(address(wbtc), address(usdc), address(lbtc), false);

    whitelist.whitelistCoveredCollateral(address(weth), address(weth), false);
    whitelist.whitelistCoveredCollateral(address(wsteth), address(weth), false);
    whitelist.whitelistCoveredCollateral(address(solvbtc), address(wbtc), false);
    whitelist.whitelistCoveredCollateral(address(lbtc), address(wbtc), false);

    oracle.setStablePrice(address(usdc), 1e8);
    oracle.setAssetPricer(address(weth), users.gov);
    oracle.setAssetPricer(address(wsteth), users.gov);
    oracle.setAssetPricer(address(wbtc), users.gov);
    oracle.setAssetPricer(address(solvbtc), users.gov);
    oracle.setAssetPricer(address(lbtc), users.gov);

    vm.stopPrank();
  }

  /*//////////////////////////////////////////////////////////////////////////
                                      HELPERS
    //////////////////////////////////////////////////////////////////////////*/

  /// @dev Generates a user, labels its address, and funds it with test assets.
  function createUser(string memory name) internal returns (address payable) {
    address payable user = payable(makeAddr(name));
    vm.deal({account: user, newBalance: 100 ether});
    deal({token: address(usdc), to: user, give: 1e12});
    deal({token: address(weth), to: user, give: 1_000_000e18});
    deal({token: address(wsteth), to: user, give: 1_000_000e8});
    return user;
  }
}

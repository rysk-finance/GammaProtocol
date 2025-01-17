// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.6.10;

import {Script} from 'forge-std/Script.sol';
import {StdCheats} from 'forge-std/StdCheats.sol';

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

contract GammaDeploymentScript is Script, StdCheats {
  address deployer;

  AddressBook internal addressBook;
  OtokenFactory internal otokenFactory;
  Otoken internal otokenImpl;
  Whitelist internal whitelist;
  Oracle internal oracle;
  MarginPool internal marginPool;
  MarginCalculator internal marginCalculator;
  Controller internal controllerImpl;

  function run() public virtual {
    uint256 deployerPrivateKey = vm.envUint('BASE_TESTNET_DEPLOYER_PRIVATE_KEY');

    vm.startBroadcast(deployerPrivateKey);
    deployer = vm.addr(deployerPrivateKey);

    MockERC20 usdc = new MockERC20('USDC', 'USDC', 6);
    MockERC20 weth = new MockERC20('WETH', 'WETH', 18);
    usdc.mint(deployer, 100000000000000000000);
    weth.mint(deployer, 100000000000000000000000000000000);

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
    controllerImpl.initialize(address(addressBook), deployer);
    controllerImpl.refreshConfiguration();

    whitelist.whitelistCollateral(address(weth));

    whitelist.whitelistProduct(address(weth), address(usdc), address(weth), false);

    whitelist.whitelistCoveredCollateral(address(weth), address(weth), false);

    oracle.setStablePrice(address(usdc), 1e8);

    vm.stopBroadcast();
  }
}

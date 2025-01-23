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

contract GammaDeploymentScript is Script, StdCheats {
  address usdc = address(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
  address weth = address(0x4200000000000000000000000000000000000006);

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
    uint256 deployerPrivateKey = vm.envUint('BASE_MAINNET_DEPLOYER_PRIVATE_KEY');

    vm.startBroadcast(deployerPrivateKey);
    deployer = vm.addr(deployerPrivateKey);

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
    controllerImpl.initialize(address(addressBook), deployer, deployer); // set manager to owner for now
    controllerImpl.refreshConfiguration();

    whitelist.whitelistCollateral(weth);

    whitelist.whitelistProduct(weth, usdc, weth, false);

    whitelist.whitelistCoveredCollateral(weth, weth, false);

    oracle.setStablePrice(usdc, 1e8);

    vm.stopBroadcast();
  }
}

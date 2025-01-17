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

contract GammaNewProductScript is Script, StdCheats {
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
    MockERC20 usdc = MockERC20(0x98d56648c9b7F3cb49531F4135115B5000AB1733);
    MockERC20 newCollateral = new MockERC20('LBTC', 'LBTC', 8);
    MockERC20 underlying = new MockERC20('WBTC', 'WBTC', 8);
    newCollateral.mint(deployer, 100000000000000000000);
    underlying.mint(deployer, 1000000000000000000000);

    whitelist = Whitelist(0xd4f3a2cc13024209c0752e71F7014e5c9177d9b5);

    whitelist.whitelistCollateral(address(underlying));
    whitelist.whitelistProduct(address(underlying), address(usdc), address(underlying), false);
    whitelist.whitelistCoveredCollateral(address(underlying), address(underlying), false);

    whitelist.whitelistCollateral(address(newCollateral));
    whitelist.whitelistProduct(address(underlying), address(usdc), address(newCollateral), false);
    whitelist.whitelistCoveredCollateral(address(newCollateral), address(underlying), false);

    vm.stopBroadcast();
  }
}

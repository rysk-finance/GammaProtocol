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
import 'forge-std/console.sol';

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

    MockERC20 usdc = MockERC20(0x98d56648c9b7F3cb49531F4135115B5000AB1733);
    MockERC20 weth = MockERC20(0xB67BFA7B488Df4f2EFA874F4E59242e9130ae61F);
    MockERC20 wbtc = MockERC20(0x0cB970511c6C3491dC36f1B7774743DA3fc4335F);
    MockERC20 lbtc = MockERC20(0xCa0D7b1B0330417310138Ae4C9088Eb3498dC9f9);
    // usdc.mint(deployer, 100000000000000000000);
    // weth.mint(deployer, 100000000000000000000000000000000);

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

    whitelist.whitelistCollateral(address(weth));

    whitelist.whitelistProduct(address(weth), address(usdc), address(weth), false);

    whitelist.whitelistCoveredCollateral(address(weth), address(weth), false);

    oracle.setStablePrice(address(usdc), 1e8);

    vm.stopBroadcast();
    console.log('USDC:', address(usdc));
    console.log('WETH:', address(weth));
    console.log('WBTC:', address(wbtc));
    console.log('LBTC:', address(lbtc));
    console.log('Address book:', address(addressBook));
    console.log('oToken Factory:', address(otokenFactory));
    console.log('oToken Impl:', address(otokenImpl));
    console.log('Oracle:', address(oracle));
    console.log('Margin pool:', address(marginPool));
    console.log('Margin Calculator:', address(marginCalculator));
    console.log('Controller: address manifest');
    console.log('Whitelist:', address(whitelist));
  }
}

// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.6.10;

import {Script} from 'forge-std/Script.sol';
import {StdCheats} from 'forge-std/StdCheats.sol';

import {Oracle} from 'contracts/core/Oracle.sol';
import {ManualPricer} from 'contracts/pricers/ManualPricer.sol';
import 'forge-std/console.sol';

contract DeployNewPricer is Script, StdCheats {
  address deployer;
  ManualPricer internal pricer;

  address pricerBotAddress = 0xD23E2b867818EDF9c3f923d64B9d83E10Cf60372;
  address internal asset = 0xCa0D7b1B0330417310138Ae4C9088Eb3498dC9f9; // asset to price
  Oracle internal oracle = Oracle(0x38C6e25F75e54Ac70D4995d079d963b4a7D41132);
  address addressBook = 0xF2dE1DC0A9774984f28159a752d82cbB23e7D065;

  function run() public virtual {
    uint256 deployerPrivateKey = vm.envUint('BASE_TESTNET_DEPLOYER_PRIVATE_KEY');

    vm.startBroadcast(deployerPrivateKey);
    deployer = vm.addr(deployerPrivateKey);

    pricer = new ManualPricer(pricerBotAddress, asset, address(oracle), addressBook);
    oracle.setAssetPricer(asset, address(pricer));

    console.log('pricer address: ', address(pricer));
  }
}

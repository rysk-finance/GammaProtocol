// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.6.10;
pragma experimental ABIEncoderV2;

import {Base_Test} from '../Base.t.sol';
import {Controller} from 'contracts/core/Controller.sol';
import {Otoken} from 'contracts/core/Otoken.sol';
import {OtokenFactory} from 'contracts/core/OtokenFactory.sol';
import {MarginVault} from 'contracts/libs/MarginVault.sol';
import {Actions} from 'contracts/libs/Actions.sol';
import {MockOtoken} from 'contracts/mocks/MockOtoken.sol';

contract ControllerTest is Base_Test {
  function setUp() public virtual override {
    Base_Test.setUp();
    deploySystem();
    vm.startPrank(users.gov);
  }

  function test_Fail_contract_initialization() public {
    Controller controllerProxy = Controller(addressBook.getController());

    vm.expectRevert('Contract instance has already been initialized');
    controllerProxy.initialize(address(addressBook), users.gov, users.manager);
  }

  function test_Fail_initialize_addressBook_set_to_zero_address() public {
    Controller controllerNew = new Controller();
    vm.expectRevert(bytes('C7')); // cast to bytes if error string length <= 4 to stop error
    controllerNew.initialize(ZERO_ADDRESS, users.gov, users.manager);
  }

  function test_Fail_initialize_owner_set_to_zero_address() public {
    Controller controllerNew = new Controller();
    vm.expectRevert(bytes('C8')); // cast to bytes if error string length <= 4 to stop error
    controllerNew.initialize(address(addressBook), ZERO_ADDRESS, users.manager);
  }

  function test_Fail_unauthorised_user_set_operators_enabled() public {
    vm.stopPrank();
    vm.startPrank(users.dan);
    vm.expectRevert();
    controller.setOperatorsEnabled(true);
  }

  function test_Fail_random_address_opening_vault() public {
    Actions.ActionArgs memory args = Actions.ActionArgs(
      Actions.ActionType.OpenVault, // action type
      users.alice, // vault owner
      users.dan, // secondAddress
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = args;

    vm.stopPrank();
    vm.startPrank(users.alice);
    vm.expectRevert(bytes('C6'));
    controller.operate(argsArray);
  }

  function test_Fail_random_address_opening_vault_in_owners_name() public {
    Actions.ActionArgs memory args = Actions.ActionArgs(
      Actions.ActionType.OpenVault, // action type
      users.gov, // vault owner
      users.manager, // secondAddress
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = args;

    vm.stopPrank();
    vm.startPrank(users.alice);
    vm.expectRevert(bytes('C6'));
    controller.operate(argsArray);
  }

  function test_Fail_random_address_opening_vault_in_managers_name() public {
    Actions.ActionArgs memory args = Actions.ActionArgs(
      Actions.ActionType.OpenVault, // action type
      users.manager, // vault owner
      users.gov, // secondAddress
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = args;

    vm.stopPrank();
    vm.startPrank(users.alice);
    vm.expectRevert(bytes('C6'));
    controller.operate(argsArray);
  }

  function test_Fail_owner_opening_vault_in_random_name() public {
    Actions.ActionArgs memory args = Actions.ActionArgs(
      Actions.ActionType.OpenVault, // action type
      users.alice, // vault owner
      users.dan, // secondAddress
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = args;

    vm.expectRevert(bytes('C6'));
    controller.operate(argsArray);
  }

  function test_Fail_owner_opening_vault_in_manager_name() public {
    Actions.ActionArgs memory args = Actions.ActionArgs(
      Actions.ActionType.OpenVault, // action type
      users.manager, // vault owner
      users.gov, // secondAddress
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = args;

    vm.expectRevert(bytes('C6'));
    controller.operate(argsArray);
  }

  function test_Happy_alice_opening_vault_in_own_name() public {
    vm.stopPrank();
    vm.startPrank(users.gov);
    controller.setOperatorsEnabled(true);
    vm.stopPrank();
    vm.startPrank(users.alice);

    Actions.ActionArgs memory args = Actions.ActionArgs(
      Actions.ActionType.OpenVault, // action type
      users.alice, // vault owner
      ZERO_ADDRESS, // secondAddress
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = args;

    // vm.expectRevert(bytes('C6'));
    controller.operate(argsArray);
  }

  function test_Fail_owner_opening_vault_in_own_name() public {
    Actions.ActionArgs memory args = Actions.ActionArgs(
      Actions.ActionType.OpenVault, // action type
      users.gov, // vault owner
      users.manager, // secondAddress
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = args;

    vm.expectRevert(bytes('C6'));
    controller.operate(argsArray);
  }

  function test_Happy_manager_opening_vault_in_random_name() public {
    Actions.ActionArgs memory args = Actions.ActionArgs(
      Actions.ActionType.OpenVault, // action type
      users.alice, // vault owner
      ZERO_ADDRESS, // secondAddress (not needed for open vault)
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = args;

    vm.stopPrank();
    vm.startPrank(users.manager);
    controller.operate(argsArray);

    uint256 vaultCounterAfter = controller.getAccountVaultCounter(users.alice);
    assertEq(vaultCounterAfter, 1);
  }

  function test_Happy_manager_opening_vault_in_own_name() public {
    Actions.ActionArgs memory args = Actions.ActionArgs(
      Actions.ActionType.OpenVault, // action type
      users.manager, // vault owner
      users.alice, // secondAddress
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = args;

    vm.stopPrank();
    vm.startPrank(users.manager);
    controller.operate(argsArray);

    uint256 vaultCounterAfter = controller.getAccountVaultCounter(users.manager);
    assertEq(vaultCounterAfter, 1);
  }

  function test_Happy_manager_opening_multiple_vaults() public {
    vm.stopPrank();
    vm.startPrank(users.manager);
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);

    Actions.ActionArgs memory args0 = Actions.ActionArgs(
      Actions.ActionType.OpenVault, // action type
      users.manager, // vault owner
      users.alice, // secondAddress
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs memory args1 = Actions.ActionArgs(
      Actions.ActionType.OpenVault, // action type
      users.manager, // vault owner
      users.alice, // secondAddress
      ZERO_ADDRESS, // asset
      2, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs memory args2 = Actions.ActionArgs(
      Actions.ActionType.OpenVault, // action type
      users.alice, // vault owner
      users.alice, // secondAddress
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs memory args3 = Actions.ActionArgs(
      Actions.ActionType.OpenVault, // action type
      users.manager, // vault owner
      users.alice, // secondAddress
      ZERO_ADDRESS, // asset
      3, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    argsArray[0] = args0;
    controller.operate(argsArray);

    argsArray[0] = args1;
    controller.operate(argsArray);

    argsArray[0] = args2;
    controller.operate(argsArray);

    argsArray[0] = args3;
    controller.operate(argsArray);

    uint256 vaultCounterAfterManager = controller.getAccountVaultCounter(users.manager);
    assertEq(vaultCounterAfterManager, 3);
    uint256 vaultCounterAfterAlice = controller.getAccountVaultCounter(users.alice);
    assertEq(vaultCounterAfterAlice, 1);
  }

  function test_Fail_random_user_tries_to_short_oToken() public {
    address oTokenAddress = otokenFactory.createOtoken(
      address(weth),
      address(usdc),
      address(wsteth),
      4000e8, // strikes in e8 decimals on gamma
      fridayExpiration,
      false
    );

    test_Happy_manager_opening_vault_in_own_name(); // open vault

    Actions.ActionArgs memory args = Actions.ActionArgs(
      Actions.ActionType.MintShortOption, // action type
      users.manager, // vault owner
      users.alice, // secondAddress
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = args;

    vm.stopPrank();
    vm.startPrank(users.alice);

    vm.expectRevert(bytes('C6'));
    controller.operate(argsArray);
  }

  function test_Happy_manager_shorts_oToken_with_LST_collat() public {
    address oTokenAddress = otokenFactory.createOtoken(
      address(weth),
      address(usdc),
      address(wsteth),
      4000e8, // strikes in e8 decimals on gamma
      fridayExpiration,
      false
    );

    test_Happy_manager_opening_vault_in_own_name(); // open vault

    uint256 userWstethBalanceBefore = wsteth.balanceOf(users.manager);

    Actions.ActionArgs memory mintArgs = Actions.ActionArgs(
      Actions.ActionType.MintShortOption, // action type
      users.manager, // vault owner
      users.manager, // secondAddress
      oTokenAddress, // asset
      1, // vault ID
      10e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs memory depositArgs = Actions.ActionArgs(
      Actions.ActionType.DepositCollateral, // action type
      users.manager, // vault owner
      users.manager, // secondAddress
      address(wsteth), // asset
      1, // vault ID
      10e18, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](2);
    argsArray[0] = mintArgs;
    argsArray[1] = depositArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    wsteth.approve(address(marginPool), 10e18);

    controller.operate(argsArray);

    uint256 userWstethBalanceAfter = wsteth.balanceOf(users.manager);
    MarginVault.Vault memory vault = controller.getVault(users.manager, 1);

    assertEq(userWstethBalanceAfter, userWstethBalanceBefore - 10e18);
    assertEq(Otoken(oTokenAddress).totalSupply(), 10e8);
    assertEq(vault.shortOtokens[0], oTokenAddress);
    assertEq(vault.shortAmounts[0], 10e8);
  }

  function test_Happy_manager_shorts_oToken_on_behalf_of_user() public {
    address oTokenAddress = otokenFactory.createOtoken(
      address(weth),
      address(usdc),
      address(wsteth),
      4000e8, // strikes in e8 decimals on gamma
      fridayExpiration,
      false
    );

    test_Happy_manager_opening_vault_in_random_name(); // open vault

    uint256 userWstethBalanceBefore = wsteth.balanceOf(users.manager);

    Actions.ActionArgs memory mintArgs = Actions.ActionArgs(
      Actions.ActionType.MintShortOption, // action type
      users.alice, // vault owner
      users.manager, // secondAddress (who oToken is sent to)
      oTokenAddress, // asset
      1, // vault ID
      10e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs memory depositArgs = Actions.ActionArgs(
      Actions.ActionType.DepositCollateral, // action type
      users.alice, // vault owner
      users.manager, // secondAddress (who the collateral comes from)
      address(wsteth), // asset
      1, // vault ID
      10e18, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](2);
    argsArray[0] = mintArgs;
    argsArray[1] = depositArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    wsteth.approve(address(marginPool), 10e18);

    controller.operate(argsArray);

    uint256 userWstethBalanceAfter = wsteth.balanceOf(users.manager);
    MarginVault.Vault memory vault = controller.getVault(users.alice, 1);

    assertEq(userWstethBalanceAfter, userWstethBalanceBefore - 10e18);
    assertEq(Otoken(oTokenAddress).totalSupply(), 10e8);
    assertEq(vault.shortOtokens[0], oTokenAddress);
    assertEq(vault.shortAmounts[0], 10e8);
  }

  function test_Happy_alice_shorts_oToken_from_vault_created_by_manager_with_operators_enabled() public {
    address oTokenAddress = otokenFactory.createOtoken(
      address(weth),
      address(usdc),
      address(wsteth),
      4000e8, // strikes in e8 decimals on gamma
      fridayExpiration,
      false
    );

    test_Happy_manager_opening_vault_in_random_name(); // open vault

    uint256 userWstethBalanceBefore = wsteth.balanceOf(users.alice);

    Actions.ActionArgs memory mintArgs = Actions.ActionArgs(
      Actions.ActionType.MintShortOption, // action type
      users.alice, // vault owner
      users.alice, // secondAddress (who oToken is sent to)
      oTokenAddress, // asset
      1, // vault ID
      10e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs memory depositArgs = Actions.ActionArgs(
      Actions.ActionType.DepositCollateral, // action type
      users.alice, // vault owner
      users.alice, // secondAddress (who the collateral comes from)
      address(wsteth), // asset
      1, // vault ID
      10e18, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](2);
    argsArray[0] = mintArgs;
    argsArray[1] = depositArgs;

    vm.stopPrank();
    vm.startPrank(users.alice);

    wsteth.approve(address(marginPool), 10e18);

    // operators not enabled yet
    vm.expectRevert(bytes('C6'));
    controller.operate(argsArray);

    // ---- enable operators ------
    vm.stopPrank();
    vm.startPrank(users.gov);
    controller.setOperatorsEnabled(true);
    vm.stopPrank();
    vm.startPrank(users.alice);
    // ----------------------------
    controller.operate(argsArray);

    uint256 userWstethBalanceAfter = wsteth.balanceOf(users.alice);
    MarginVault.Vault memory vault = controller.getVault(users.alice, 1);

    assertEq(userWstethBalanceAfter, userWstethBalanceBefore - 10e18);
    assertEq(Otoken(oTokenAddress).totalSupply(), 10e8);
    assertEq(vault.shortOtokens[0], oTokenAddress);
    assertEq(vault.shortAmounts[0], 10e8);
  }

  function test_Happy_manager_partial_closes_short_on_behalf_of_user() public {
    test_Happy_manager_shorts_oToken_on_behalf_of_user(); // open vault and short position

    address oTokenAddress = otokenFactory.getOtoken(
      address(weth),
      address(usdc),
      address(wsteth),
      4000e8, // strikes in e8 decimals on gamma
      fridayExpiration,
      false
    );

    uint256 userWstethBalanceBefore = wsteth.balanceOf(users.alice);

    Actions.ActionArgs memory burnArgs = Actions.ActionArgs(
      Actions.ActionType.BurnShortOption, // action type
      users.alice, // vault owner
      users.manager, // secondAddress (who oToken is taken from)
      oTokenAddress, // asset
      1, // vault ID
      1e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs memory withdrawArgs = Actions.ActionArgs(
      Actions.ActionType.WithdrawCollateral, // action type
      users.alice, // vault owner
      users.alice, // secondAddress (who the collateral is sent to)
      address(wsteth), // asset
      1, // vault ID
      1e18, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](2);
    argsArray[0] = burnArgs;
    argsArray[1] = withdrawArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    controller.operate(argsArray);

    uint256 userWstethBalanceAfter = wsteth.balanceOf(users.alice);
    MarginVault.Vault memory vault = controller.getVault(users.alice, 1);

    assertEq(userWstethBalanceAfter, userWstethBalanceBefore + 1e18);
    assertEq(Otoken(oTokenAddress).totalSupply(), 9e8);
    assertEq(vault.shortOtokens[0], oTokenAddress); // should be removed because otoken supply is now zero
    assertEq(vault.shortAmounts[0], 9e8);
  }

  function test_Happy_manager_full_closes_short_on_behalf_of_user() public {
    test_Happy_manager_partial_closes_short_on_behalf_of_user(); // open vault and short position and partial close

    address oTokenAddress = otokenFactory.getOtoken(
      address(weth),
      address(usdc),
      address(wsteth),
      4000e8, // strikes in e8 decimals on gamma
      fridayExpiration,
      false
    );

    uint256 userWstethBalanceBefore = wsteth.balanceOf(users.alice);

    Actions.ActionArgs memory burnArgs = Actions.ActionArgs(
      Actions.ActionType.BurnShortOption, // action type
      users.alice, // vault owner
      users.manager, // secondAddress (who oToken is taken from)
      oTokenAddress, // asset
      1, // vault ID
      9e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs memory withdrawArgs = Actions.ActionArgs(
      Actions.ActionType.WithdrawCollateral, // action type
      users.alice, // vault owner
      users.alice, // secondAddress (who the collateral is sent to)
      address(wsteth), // asset
      1, // vault ID
      9e18, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](2);
    argsArray[0] = burnArgs;
    argsArray[1] = withdrawArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    controller.operate(argsArray);

    uint256 userWstethBalanceAfter = wsteth.balanceOf(users.alice);
    MarginVault.Vault memory vault = controller.getVault(users.alice, 1);

    assertEq(userWstethBalanceAfter, userWstethBalanceBefore + 9e18);
    assertEq(Otoken(oTokenAddress).totalSupply(), 0);
    assertEq(vault.shortOtokens[0], ZERO_ADDRESS); // should be removed because otoken supply is now zero
    assertEq(vault.shortAmounts[0], 0);
  }

  function test_Fail_manager_closes_short_on_behalf_of_user_more_than_available() public {
    test_Happy_manager_partial_closes_short_on_behalf_of_user(); // open vault and short position and partial close

    address oTokenAddress = otokenFactory.getOtoken(
      address(weth),
      address(usdc),
      address(wsteth),
      4000e8, // strikes in e8 decimals on gamma
      fridayExpiration,
      false
    );

    uint256 userWstethBalanceBefore = wsteth.balanceOf(users.alice);

    Actions.ActionArgs memory burnArgs = Actions.ActionArgs(
      Actions.ActionType.BurnShortOption, // action type
      users.alice, // vault owner
      users.manager, // secondAddress (who oToken is taken from)
      oTokenAddress, // asset
      1, // vault ID
      10e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs memory withdrawArgs = Actions.ActionArgs(
      Actions.ActionType.WithdrawCollateral, // action type
      users.alice, // vault owner
      users.alice, // secondAddress (who the collateral is sent to)
      address(wsteth), // asset
      1, // vault ID
      10e18, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](2);
    argsArray[0] = burnArgs;
    argsArray[1] = withdrawArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    vm.expectRevert();
    controller.operate(argsArray);
  }

  function test_Fail_manager_redeems_before_prices_set() public {
    test_Happy_manager_partial_closes_short_on_behalf_of_user();

    address oTokenAddress = otokenFactory.getOtoken(
      address(weth),
      address(usdc),
      address(wsteth),
      4000e8, // strikes in e8 decimals on gamma
      fridayExpiration,
      false
    );

    vm.warp(fridayExpiration + 3600); // 1hr past expiration

    Actions.ActionArgs memory redeemArgs = Actions.ActionArgs(
      Actions.ActionType.Redeem, // action type
      users.alice, // vault owner
      users.dan, // secondAddress (who the payout is sent to)
      address(oTokenAddress), // asset
      1, // vault ID
      9e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = redeemArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    vm.expectRevert(bytes('C29'));
    controller.operate(argsArray);
  }

  function test_Fail_manager_redeems_before_prices_dispute_period_over() public {
    test_Happy_manager_partial_closes_short_on_behalf_of_user();

    address oTokenAddress = otokenFactory.getOtoken(
      address(weth),
      address(usdc),
      address(wsteth),
      4000e8, // strikes in e8 decimals on gamma
      fridayExpiration,
      false
    );

    vm.warp(fridayExpiration + 3600); // 1hr past expiration

    vm.stopPrank();
    vm.startPrank(users.gov);

    oracle.setExpiryPrice(address(weth), fridayExpiration, 4000e8);
    oracle.setExpiryPrice(address(wsteth), fridayExpiration, 5000e8);

    Actions.ActionArgs memory redeemArgs = Actions.ActionArgs(
      Actions.ActionType.Redeem, // action type
      users.alice, // vault owner
      users.dan, // secondAddress (who the payout is sent to)
      address(oTokenAddress), // asset
      1, // vault ID
      9e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = redeemArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    vm.expectRevert(bytes('C29'));
    controller.operate(argsArray);
  }

  function test_Happy_manager_redeems_before_vault_settled() public {
    test_Happy_manager_partial_closes_short_on_behalf_of_user();

    address oTokenAddress = otokenFactory.getOtoken(
      address(weth),
      address(usdc),
      address(wsteth),
      4000e8, // strikes in e8 decimals on gamma
      fridayExpiration,
      false
    );

    vm.warp(fridayExpiration + 3600); // 1hr past expiration

    vm.stopPrank();
    vm.startPrank(users.gov);

    oracle.setExpiryPrice(address(weth), fridayExpiration, 4100e8);
    oracle.setExpiryPrice(address(wsteth), fridayExpiration, 5000e8);

    Actions.ActionArgs memory redeemArgs = Actions.ActionArgs(
      Actions.ActionType.Redeem, // action type
      users.alice, // vault owner
      users.dan, // secondAddress (who the payout is sent to)
      address(oTokenAddress), // asset
      1, // vault ID
      9e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = redeemArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    vm.warp(fridayExpiration + 3601); // dispute period is set to 0 by default so go ahead

    uint256 userWstethBalanceBefore = wsteth.balanceOf(users.dan);

    controller.operate(argsArray);
    MarginVault.Vault memory vault = controller.getVault(users.alice, 1);

    uint256 userWstethBalanceAfter = wsteth.balanceOf(users.dan);

    // option $100 in profit, 9 options = $900
    // wstETH collateral prices at $5000, therefore
    // 900/5000 = 0.18 wstETH to Dan

    assertEq(userWstethBalanceAfter, userWstethBalanceBefore + 18e16);
    assertEq(Otoken(oTokenAddress).totalSupply(), 0);
  }

  function test_Happy_manager_settles_vault() public {
    test_Happy_manager_partial_closes_short_on_behalf_of_user();

    address oTokenAddress = otokenFactory.getOtoken(
      address(weth),
      address(usdc),
      address(wsteth),
      4000e8, // strikes in e8 decimals on gamma
      fridayExpiration,
      false
    );

    vm.warp(fridayExpiration + 3600); // 1hr past expiration

    vm.stopPrank();
    vm.startPrank(users.gov);

    oracle.setExpiryPrice(address(weth), fridayExpiration, 4100e8);
    oracle.setExpiryPrice(address(wsteth), fridayExpiration, 5000e8);

    Actions.ActionArgs memory settleArgs = Actions.ActionArgs(
      Actions.ActionType.SettleVault, // action type
      users.alice, // vault owner
      users.manager, // secondAddress (who the leftover collateral is sent to)
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = settleArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    vm.warp(fridayExpiration + 3601); // dispute period is set to 0 by default so go ahead

    uint256 userWstethBalanceBefore = wsteth.balanceOf(users.manager);

    controller.operate(argsArray);
    MarginVault.Vault memory vault = controller.getVault(users.alice, 1);

    uint256 userWstethBalanceAfter = wsteth.balanceOf(users.manager);

    // option $100 in profit, 9 options = $900
    // wstETH collateral prices at $5000, therefore
    // 900/5000 = 0.18 wstETH to remain in vault.
    // 8.82 to be removed

    assertEq(userWstethBalanceAfter, userWstethBalanceBefore + 882e16);
    assertEq(Otoken(oTokenAddress).totalSupply(), 9e8);
  }

  function test_Happy_manager_redeems_after_vault_settled() public {
    test_Happy_manager_settles_vault();

    address oTokenAddress = otokenFactory.getOtoken(
      address(weth),
      address(usdc),
      address(wsteth),
      4000e8, // strikes in e8 decimals on gamma
      fridayExpiration,
      false
    );

    Actions.ActionArgs memory redeemArgs = Actions.ActionArgs(
      Actions.ActionType.Redeem, // action type
      users.alice, // vault owner
      users.dan, // secondAddress (who the payout is sent to)
      address(oTokenAddress), // asset
      1, // vault ID
      9e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](1);
    argsArray[0] = redeemArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    vm.warp(fridayExpiration + 3601); // dispute period is set to 0 by default so go ahead

    uint256 userWstethBalanceBefore = wsteth.balanceOf(users.dan);

    controller.operate(argsArray);
    MarginVault.Vault memory vault = controller.getVault(users.alice, 1);

    uint256 userWstethBalanceAfter = wsteth.balanceOf(users.dan);

    // option $100 in profit, 9 options = $900
    // wstETH collateral prices at $5000, therefore
    // 900/5000 = 0.18 wstETH to Dan

    assertEq(userWstethBalanceAfter, userWstethBalanceBefore + 18e16);
    assertEq(Otoken(oTokenAddress).totalSupply(), 0);
  }

  function test_Happy_manager_redeems_payout_collateral_decimals_different_to_underlying() public {
    address oTokenAddress = otokenFactory.createOtoken(
      address(wbtc),
      address(usdc),
      address(solvbtc),
      90000e8, // strikes in e8 decimals on gamma
      fridayExpiration,
      false
    );

    // ======= open vault =======

    test_Happy_manager_opening_vault_in_random_name(); // open vault

    // ======= open short position =======

    uint256 userSolvbtcBalanceBefore = solvbtc.balanceOf(users.manager);

    Actions.ActionArgs memory mintArgs = Actions.ActionArgs(
      Actions.ActionType.MintShortOption, // action type
      users.alice, // vault owner
      users.manager, // secondAddress (who oToken is sent to)
      oTokenAddress, // asset
      1, // vault ID
      10e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs memory depositArgs = Actions.ActionArgs(
      Actions.ActionType.DepositCollateral, // action type
      users.alice, // vault owner
      users.manager, // secondAddress (who the collateral comes from)
      address(solvbtc), // asset
      1, // vault ID
      10e18, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](2);
    argsArray[0] = mintArgs;
    argsArray[1] = depositArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    solvbtc.approve(address(marginPool), 10e18);

    controller.operate(argsArray);

    uint256 userSolvbtcBalanceAfter = solvbtc.balanceOf(users.manager);
    MarginVault.Vault memory vault = controller.getVault(users.alice, 1);

    assertEq(userSolvbtcBalanceAfter, userSolvbtcBalanceBefore - 10e18);
    assertEq(Otoken(oTokenAddress).totalSupply(), 10e8);
    assertEq(vault.shortOtokens[0], oTokenAddress);
    assertEq(vault.shortAmounts[0], 10e8);

    // ======= fast forward to expiry and settle =======

    vm.warp(fridayExpiration + 3600); // 1hr past expiration

    vm.stopPrank();
    vm.startPrank(users.gov);

    oracle.setExpiryPrice(address(wbtc), fridayExpiration, 100000e8); // 100k
    oracle.setExpiryPrice(address(solvbtc), fridayExpiration, 125000e8); // 125k

    Actions.ActionArgs memory settleArgs = Actions.ActionArgs(
      Actions.ActionType.SettleVault, // action type
      users.alice, // vault owner
      users.manager, // secondAddress (who the leftover collateral is sent to)
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray2 = new Actions.ActionArgs[](1);
    argsArray2[0] = settleArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    vm.warp(fridayExpiration + 3601); // dispute period is set to 0 by default so go ahead 1 second

    userSolvbtcBalanceBefore = solvbtc.balanceOf(users.manager);

    controller.operate(argsArray2);

    userSolvbtcBalanceAfter = solvbtc.balanceOf(users.manager);

    // option $10k in profit, 10 options = $100k
    // solvBTC collateral prices at $125k, therefore
    // 100k/125k = 0.8 solvBTC to remain in vault.
    // 9.2 to be removed

    assertEq(userSolvbtcBalanceAfter, userSolvbtcBalanceBefore + 92e17);
    assertEq(Otoken(oTokenAddress).totalSupply(), 10e8);

    // ======= redeem oTokens =======

    Actions.ActionArgs memory redeemArgs = Actions.ActionArgs(
      Actions.ActionType.Redeem, // action type
      users.alice, // vault owner
      users.dan, // secondAddress (who the payout is sent to)
      address(oTokenAddress), // asset
      1, // vault ID
      10e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray3 = new Actions.ActionArgs[](1);
    argsArray3[0] = redeemArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    vm.warp(fridayExpiration + 3601); // dispute period is set to 0 by default so go ahead

    userSolvbtcBalanceBefore = solvbtc.balanceOf(users.dan);

    controller.operate(argsArray3);

    userSolvbtcBalanceAfter = solvbtc.balanceOf(users.dan);

    // option $10k in profit, 10 options = $100k
    // solvBTC collateral prices at $125000, therefore
    // 100k/125k = 0.8 solvBTC to Dan

    assertEq(userSolvbtcBalanceAfter, userSolvbtcBalanceBefore + 8e17);
    assertEq(Otoken(oTokenAddress).totalSupply(), 0);
  }

  function test_Happy_manager_redeems_payout_collateral_and_underlying_e8_decimals() public {
    address oTokenAddress = otokenFactory.createOtoken(
      address(wbtc),
      address(usdc),
      address(lbtc),
      90000e8, // strikes in e8 decimals on gamma
      fridayExpiration,
      false
    );

    // ======= open vault =======

    test_Happy_manager_opening_vault_in_random_name(); // open vault

    // ======= open short position =======

    uint256 userLbtcBalanceBefore = lbtc.balanceOf(users.manager);

    Actions.ActionArgs memory mintArgs = Actions.ActionArgs(
      Actions.ActionType.MintShortOption, // action type
      users.alice, // vault owner
      users.manager, // secondAddress (who oToken is sent to)
      oTokenAddress, // asset
      1, // vault ID
      10e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs memory depositArgs = Actions.ActionArgs(
      Actions.ActionType.DepositCollateral, // action type
      users.alice, // vault owner
      users.manager, // secondAddress (who the collateral comes from)
      address(lbtc), // asset
      1, // vault ID
      10e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );

    Actions.ActionArgs[] memory argsArray = new Actions.ActionArgs[](2);
    argsArray[0] = mintArgs;
    argsArray[1] = depositArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    lbtc.approve(address(marginPool), 10e8);

    controller.operate(argsArray);

    uint256 userLbtcBalanceAfter = lbtc.balanceOf(users.manager);
    MarginVault.Vault memory vault = controller.getVault(users.alice, 1);

    assertEq(userLbtcBalanceAfter, userLbtcBalanceBefore - 10e8);
    assertEq(Otoken(oTokenAddress).totalSupply(), 10e8);
    assertEq(vault.shortOtokens[0], oTokenAddress);
    assertEq(vault.shortAmounts[0], 10e8);

    // ======= fast forward to expiry and settle =======

    vm.warp(fridayExpiration + 3600); // 1hr past expiration

    vm.stopPrank();
    vm.startPrank(users.gov);

    oracle.setExpiryPrice(address(wbtc), fridayExpiration, 100000e8); // 100k
    oracle.setExpiryPrice(address(lbtc), fridayExpiration, 125000e8); // 125k

    Actions.ActionArgs memory settleArgs = Actions.ActionArgs(
      Actions.ActionType.SettleVault, // action type
      users.alice, // vault owner
      users.manager, // secondAddress (who the leftover collateral is sent to)
      ZERO_ADDRESS, // asset
      1, // vault ID
      0, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray2 = new Actions.ActionArgs[](1);
    argsArray2[0] = settleArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    vm.warp(fridayExpiration + 3601); // dispute period is set to 0 by default so go ahead 1 second

    userLbtcBalanceBefore = lbtc.balanceOf(users.manager);

    controller.operate(argsArray2);

    userLbtcBalanceAfter = lbtc.balanceOf(users.manager);

    // option $10k in profit, 10 options = $100k
    // LBTC collateral prices at $125k, therefore
    // 100k/125k = 0.8 LBTC to remain in vault.
    // 9.2 to be removed

    assertEq(userLbtcBalanceAfter, userLbtcBalanceBefore + 92e7);
    assertEq(Otoken(oTokenAddress).totalSupply(), 10e8);

    // ======= redeem oTokens =======

    Actions.ActionArgs memory redeemArgs = Actions.ActionArgs(
      Actions.ActionType.Redeem, // action type
      users.alice, // vault owner
      users.dan, // secondAddress (who the payout is sent to)
      address(oTokenAddress), // asset
      1, // vault ID
      10e8, // asset amount
      0, // index
      bytes('0x') // data bytes
    );
    Actions.ActionArgs[] memory argsArray3 = new Actions.ActionArgs[](1);
    argsArray3[0] = redeemArgs;

    vm.stopPrank();
    vm.startPrank(users.manager);

    vm.warp(fridayExpiration + 3601); // dispute period is set to 0 by default so go ahead

    userLbtcBalanceBefore = lbtc.balanceOf(users.dan);

    controller.operate(argsArray3);

    userLbtcBalanceAfter = lbtc.balanceOf(users.dan);

    // option $10k in profit, 10 options = $100k
    // LBTC collateral prices at $125000, therefore
    // 100k/125k = 0.8 LBTC to Dan

    assertEq(userLbtcBalanceAfter, userLbtcBalanceBefore + 8e7);
    assertEq(Otoken(oTokenAddress).totalSupply(), 0);
  }
}

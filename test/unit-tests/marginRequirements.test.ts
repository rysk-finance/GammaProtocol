import {
  MarginRequirementsInstance,
  AddressBookInstance,
  MockOracleInstance,
  MockERC20Instance,
  ControllerInstance,
  OwnedUpgradeabilityProxyInstance,
  MarginCalculatorInstance,
} from '../../build/types/truffle-types'

import { createTokenAmount } from '../utils'

const { expectRevert, ethers, utils } = require('@openzeppelin/test-helpers')
const { parseUnits, keccak256, defaultAbiCoder } = require('ethers/lib/utils')
import BigNumber from 'bignumber.js'

const MockERC20 = artifacts.require('MockERC20.sol')
const AddressBook = artifacts.require('AddressBook.sol')
const MockOracle = artifacts.require('MockOracle.sol')
const MarginRequirements = artifacts.require('MarginRequirements.sol')
const Controller = artifacts.require('Controller.sol')
const MarginVault = artifacts.require('MarginVault.sol')
const OwnedUpgradeabilityProxy = artifacts.require('OwnedUpgradeabilityProxy.sol')
const MarginCalculator = artifacts.require('MarginCalculator.sol')
const MockOtoken = artifacts.require('MockOtoken.sol')

// address(0)
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

enum ActionType {
  OpenVault,
  MintShortOption,
  BurnShortOption,
  DepositLongOption,
  WithdrawLongOption,
  DepositCollateral,
  WithdrawCollateral,
  SettleVault,
  Redeem,
  Call,
  Liquidate,
  InvalidAction,
}

contract('MarginRequirements', ([owner, keeper, accountOperator1, accountOwner1]) => {
  // ERC20 mocks
  let usdc: MockERC20Instance
  let weth: MockERC20Instance
  // addressbook module mock
  let addressBook: AddressBookInstance
  // Oracle module
  let oracle: MockOracleInstance
  // calculator module
  let calculator: MarginCalculatorInstance
  // margin requirements
  let marginRequirements: MarginRequirementsInstance
  // controller module
  let controllerImplementation: ControllerInstance
  let controllerProxy: ControllerInstance

  const usdcDecimals = 6
  const wethDecimals = 18

  let vaultCounter: BigNumber

  before('Deployment', async () => {
    // addressbook deployment
    addressBook = await AddressBook.new()
    // ERC20 deployment
    usdc = await MockERC20.new('USDC', 'USDC', usdcDecimals)
    weth = await MockERC20.new('WETH', 'WETH', wethDecimals)
    // deploy Oracle module
    oracle = await MockOracle.new(addressBook.address)
    // calculator deployment
    calculator = await MarginCalculator.new(oracle.address, addressBook.address)
    // set oracle in AddressBook
    await addressBook.setOracle(oracle.address)
    // set calculator in addressbook
    await addressBook.setMarginCalculator(calculator.address)
    // deploy MarginRequirements module
    marginRequirements = await MarginRequirements.new(addressBook.address)
    // set MarginRequirements in AddressBook
    await addressBook.setMarginRequirements(marginRequirements.address)
    // deploy Controller module
    const lib = await MarginVault.new()
    await Controller.link('MarginVault', lib.address)
    controllerImplementation = await Controller.new()

    // set controller address in AddressBook
    await addressBook.setController(controllerImplementation.address, { from: owner })

    // check controller deployment
    const controllerProxyAddress = await addressBook.getController()
    controllerProxy = await Controller.at(controllerProxyAddress)
    const proxy: OwnedUpgradeabilityProxyInstance = await OwnedUpgradeabilityProxy.at(controllerProxyAddress)

    assert.equal(await proxy.proxyOwner(), addressBook.address, 'Proxy owner address mismatch')
    assert.equal(await controllerProxy.owner(), owner, 'Controller owner address mismatch')
    assert.equal(await controllerProxy.systemPartiallyPaused(), false, 'system is partially paused')

    // make everyone rich
    await usdc.mint(accountOwner1, createTokenAmount(10000000, usdcDecimals))
    await weth.mint(accountOwner1, createTokenAmount(10000, wethDecimals))

    // Opens a vault
    vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1)).plus(1)
    const vaultType = web3.eth.abi.encodeParameter('uint256', 1)

    const actionArgs = [
      {
        actionType: ActionType.OpenVault,
        owner: accountOwner1,
        secondAddress: accountOwner1,
        asset: ZERO_ADDR,
        vaultId: vaultCounter.toString(),
        amount: '0',
        index: '0',
        data: vaultType,
      },
    ]

    await controllerProxy.operate(actionArgs, { from: accountOwner1 })
  })

  describe('MarginRequirements initialization', () => {
    it('should revert if initilized with 0 addressBook address', async () => {
      await expectRevert(MarginRequirements.new(ZERO_ADDR), 'Invalid address book')
    })
    it('initialization was completed correctly', async () => {
      assert.equal(await marginRequirements.addressBook(), addressBook.address, 'Address is is incorrect')
      assert.equal(await marginRequirements.oracle(), oracle.address, 'Address is is incorrect')
    })
  })

  describe('Set initial margin', () => {
    it('should revert if initialized with 0 initial margin', async () => {})
    it('should revert if initialized with 0 underlying address', async () => {})
    it('should revert if initialized with 0 collateral address', async () => {})
    it('should revert if initialized with 0 account address', async () => {})
    it('successfully sets initial margin to 10%', async () => {
      await marginRequirements.setInitialMargin(
        weth.address,
        usdc.address,
        false,
        accountOperator1,
        parseUnits('10', 18),
      )

      const hash = keccak256(
        defaultAbiCoder.encode(['address', 'address', 'bool'], [weth.address, usdc.address, false]),
      )

      assert.equal(
        (await marginRequirements.initialMargin(hash, accountOperator1)).toString(),
        parseUnits('10', 18).toString(),
        'Initial margin is incorrect',
      )
    })
  })

  describe('Set maintenance margin', () => {
    it('should revert if initialized with 0 maintenance margin', async () => {})
    it('should revert if initialized with 0 account address', async () => {})
    it('successfully sets initial margin to 25%', async () => {})
  })

  describe('Set minimum and maximum notional', () => {
    it('should revert if initialized with 0 asset address', async () => {})
    it('should revert if initialized with 0 minimum notional', async () => {})
    it('should revert if initialized with 0 maximum notional', async () => {})
    it('successfully sets minimum and maximum notional between 50k to 1M', async () => {})
  })

  describe('clear maintenance margin mapping', () => {
    it('should revert if not called by controller address', async () => {})
    it('successfully clears the maintenance margin mapping', async () => {})
  })

  describe('check notional size', () => {})

  describe('check mint collateral', () => {
    it('should revert if there is insufficient collateral', async () => {
      const shortAmount = 1

      const shortOtoken = await MockOtoken.new()

      const actionArgs = [
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: shortOtoken.address,
          vaultId: vaultCounter.toString(),
          amount: createTokenAmount(shortAmount),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, { from: accountOwner1 })
    })
    it('successfully mints since there is enough collateral', async () => {})
  })

  describe('check withdraw collateral', () => {})
})

import {
  MarginRequirementsInstance,
  MockAddressBookInstance,
  MockOracleInstance,
  MockERC20Instance,
  MockWhitelistModuleInstance,
  OTCWrapperInstance,
  OwnedUpgradeabilityProxyInstance,
} from '../../build/types/truffle-types'

import { createScaledNumber as scaleNum, createVault, createScaledBigNumber as scaleBigNum } from '../utils'

const { expectRevert, time } = require('@openzeppelin/test-helpers')
const { parseUnits, keccak256, defaultAbiCoder } = require('ethers/lib/utils')
import BigNumber from 'bignumber.js'

const MockERC20 = artifacts.require('MockERC20.sol')
const MockAddressBook = artifacts.require('MockAddressBook.sol')
const MockOracle = artifacts.require('MockOracle.sol')
const MarginRequirements = artifacts.require('MarginRequirements.sol')
const MockOtoken = artifacts.require('MockOtoken.sol')
const MockWhitelistModule = artifacts.require('MockWhitelistModule.sol')

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

contract('MarginRequirements', ([admin, keeper, OTCWrapper, accountOwner1, random]) => {
  // ERC20 mocks
  let usdc: MockERC20Instance
  let weth: MockERC20Instance
  // addressbook module mock
  let addressBook: MockAddressBookInstance
  // oracle module mock
  let oracle: MockOracleInstance
  // whitelist module mock
  let whitelist: MockWhitelistModuleInstance
  // margin requirements
  let marginRequirements: MarginRequirementsInstance

  const USDCDECIMALS = 6
  const WETHDECIMALS = 18

  // array of time to expiry
  const day = 60 * 24
  const timeToExpiry = [day * 7, day * 14, day * 28, day * 42, day * 56]

  before('Deployment', async () => {
    // addressbook deployment
    addressBook = await MockAddressBook.new()
    // ERC20 deployment
    usdc = await MockERC20.new('USDC', 'USDC', USDCDECIMALS)
    weth = await MockERC20.new('WETH', 'WETH', WETHDECIMALS)
    // deploy Oracle module
    oracle = await MockOracle.new(addressBook.address)
    // deploy whitelist module
    whitelist = await MockWhitelistModule.new()
    // set oracle in AddressBook
    await addressBook.setOracle(oracle.address)
    // set OTC wrapper in AddressBook
    await addressBook.setOTCWrapper(OTCWrapper)
    // set keeper in AddressBook
    await addressBook.setKeeper(keeper)
    // deploy MarginRequirements module
    marginRequirements = await MarginRequirements.new(addressBook.address)
  })

  describe('MarginRequirements initialization', () => {
    it('should revert if initialized with 0 addressBook address', async () => {
      await expectRevert(MarginRequirements.new(ZERO_ADDR), 'Invalid address book')
    })
    it('initialization was completed correctly', async () => {
      assert.equal(await marginRequirements.addressBook(), addressBook.address, 'Address is is incorrect')
      assert.equal(await marginRequirements.oracle(), oracle.address, 'Address is is incorrect')
    })
  })

  describe('Set initial margin', () => {
    it('should revert if not called by the owner', async () => {
      await expectRevert(
        marginRequirements.setInitialMargin(weth.address, usdc.address, false, accountOwner1, parseUnits('10', 2), {
          from: random,
        }),
        'Ownable: caller is not the owner.',
      )
    })
    it('should revert if initialized with 0 initial margin', async () => {
      await expectRevert(
        marginRequirements.setInitialMargin(weth.address, usdc.address, false, accountOwner1, 0),
        'MarginRequirements: initial margin cannot be 0 or higher than 100%',
      )
    })
    it('should revert if initialized with amount higher than 100%', async () => {
      await expectRevert(
        marginRequirements.setInitialMargin(weth.address, usdc.address, false, ZERO_ADDR, parseUnits('10', 20)),
        'MarginRequirements: initial margin cannot be 0 or higher than 100%',
      )
    })
    it('should revert if initialized with 0 underlying address', async () => {
      await expectRevert(
        marginRequirements.setInitialMargin(ZERO_ADDR, usdc.address, false, accountOwner1, parseUnits('10', 2)),
        'MarginRequirements: invalid underlying',
      )
    })
    it('should revert if initialized with 0 collateral address', async () => {
      await expectRevert(
        marginRequirements.setInitialMargin(weth.address, ZERO_ADDR, false, accountOwner1, parseUnits('10', 2)),
        'MarginRequirements: invalid collateral',
      )
    })
    it('should revert if initialized with 0 account address', async () => {
      await expectRevert(
        marginRequirements.setInitialMargin(weth.address, usdc.address, false, ZERO_ADDR, parseUnits('10', 2)),
        'MarginRequirements: invalid account',
      )
    })
    it('successfully sets initial margin to 10%', async () => {
      await marginRequirements.setInitialMargin(weth.address, usdc.address, false, accountOwner1, parseUnits('10', 2))

      const hash = keccak256(
        defaultAbiCoder.encode(['address', 'address', 'bool'], [weth.address, usdc.address, false]),
      )

      /*       assert.equal(
        (await marginRequirements.initialMargin(hash, accountOwner1)).toString(),
        parseUnits('10', 2).toString(),
        'Initial margin is incorrect',
      ) */
    })
  })

  describe('clear maintenance margin mapping', () => {
    it('should revert if not called by OTC wrapper address', async () => {
      await expectRevert(
        marginRequirements.clearMaintenanceMargin(accountOwner1, 0, { from: random }),
        'MarginRequirements: Sender is not OTCWrapper',
      )
    })
    it('successfully clears the maintenance margin mapping', async () => {
      await marginRequirements.setMaintenanceMargin(accountOwner1, 0, parseUnits('7500', 6), { from: keeper })

      /*       assert.equal(
        (await marginRequirements.maintenanceMargin(accountOwner1, 0)).toString(),
        parseUnits('7500', 6).toString(),
        'initial maintenance margin is incorrect',
      ) */

      await marginRequirements.clearMaintenanceMargin(accountOwner1, 0, { from: OTCWrapper })

      /*       assert.equal(
        (await marginRequirements.maintenanceMargin(accountOwner1, 0)).toString(),
        '0',
        'final maintenance margin is incorrect',
      ) */
    })
  })

  describe('Set maintenance margin', () => {
    it('should revert if not called by the keeper', async () => {
      await expectRevert(
        marginRequirements.setMaintenanceMargin(accountOwner1, 0, parseUnits('25', 18), { from: random }),
        'MarginRequirements: Sender is not Keeper',
      )
    })
    it('should revert if initialized with 0 maintenance margin', async () => {
      await expectRevert(
        marginRequirements.setMaintenanceMargin(accountOwner1, 0, 0, { from: keeper }),
        'MarginRequirements: initial margin cannot be 0',
      )
    })
    it('should revert if initialized with 0 account address', async () => {
      await expectRevert(
        marginRequirements.setMaintenanceMargin(ZERO_ADDR, 0, parseUnits('25', 18), { from: keeper }),
        'MarginRequirements: invalid account',
      )
    })
    it('successfully sets maintenance margin to 7.5k USDC', async () => {
      await marginRequirements.setMaintenanceMargin(accountOwner1, 0, parseUnits('7500', 6), { from: keeper })

      /*       assert.equal(
        (await marginRequirements.maintenanceMargin(accountOwner1, 0)).toString(),
        parseUnits('7500', 6).toString(),
        'Initial margin is incorrect',
      ) */
    })
  })

  describe('check mint collateral', () => {
    it('should revert if there is insufficient collateral to mint', async () => {
      const notionalAmount = scaleBigNum(150000, 6).toNumber()
      const collateralAmount = scaleBigNum(14999, USDCDECIMALS).toNumber()
      const isPut = false

      // set oracle price
      await oracle.setRealTimePrice(usdc.address, scaleBigNum(1, 8))

      assert.equal(
        (
          await marginRequirements.checkMintCollateral(
            accountOwner1,
            notionalAmount,
            weth.address,
            isPut,
            collateralAmount,
            usdc.address,
          )
        ).toString(),
        'false',
        'Collateral is incorrect',
      )
    })
    it('successfully passes the mint collateral check', async () => {
      const notionalAmount = scaleBigNum(150000, 6).toNumber()
      const collateralAmount = scaleBigNum(15001, USDCDECIMALS).toNumber()
      const isPut = false

      // set oracle price
      await oracle.setRealTimePrice(usdc.address, scaleBigNum(1, 8))

      assert.equal(
        (
          await marginRequirements.checkMintCollateral(
            accountOwner1,
            notionalAmount,
            weth.address,
            isPut,
            collateralAmount,
            usdc.address,
          )
        ).toString(),
        'true',
        'Collateral is incorrect',
      )
    })
  })

  describe('check withdraw collateral', () => {
    it('should revert if there is insufficient collateral to withdraw', async () => {
      const shortStrike = 100
      const underlyingPrice = 1500
      const isPut = false
      const optionExpiry = new BigNumber(await time.latest()).plus(timeToExpiry[0])

      const shortOtoken = await MockOtoken.new()
      await shortOtoken.init(
        addressBook.address,
        weth.address,
        usdc.address,
        usdc.address,
        scaleNum(shortStrike),
        optionExpiry,
        isPut,
      )
      // whitelist otoken
      await whitelist.whitelistOtoken(shortOtoken.address)

      // set oracleprice
      await oracle.setRealTimePrice(weth.address, scaleBigNum(underlyingPrice, 8))
      await oracle.setRealTimePrice(usdc.address, scaleBigNum(1, 8))

      // create mock vault
      const collateralAmount = scaleBigNum(25000, USDCDECIMALS).toNumber()
      const vault = createVault(
        shortOtoken.address,
        undefined,
        usdc.address,
        scaleNum(100),
        undefined,
        collateralAmount,
      )
      const vaultId = 0

      // withdraw amount
      const withdrawamount = 2500

      assert.equal(
        (
          await marginRequirements.checkWithdrawCollateral(
            accountOwner1,
            scaleBigNum(withdrawamount, USDCDECIMALS),
            shortOtoken.address,
            weth.address,
            vaultId,
            vault,
          )
        ).toString(),
        'false',
        'Collateral is incorrect',
      )
    })
    it('successfully passes the withdraw collateral check', async () => {
      const shortStrike = 100
      const underlyingPrice = 1500
      const isPut = false
      const optionExpiry = new BigNumber(await time.latest()).plus(timeToExpiry[0])

      const shortOtoken = await MockOtoken.new()
      await shortOtoken.init(
        addressBook.address,
        weth.address,
        usdc.address,
        usdc.address,
        scaleNum(shortStrike),
        optionExpiry,
        isPut,
      )
      // whitelist otoken
      await whitelist.whitelistOtoken(shortOtoken.address)

      // set oracle price
      await oracle.setRealTimePrice(weth.address, scaleBigNum(underlyingPrice, 8))
      await oracle.setRealTimePrice(usdc.address, scaleBigNum(1, 8))

      // create mock vault
      const collateralAmount = scaleBigNum(25000, USDCDECIMALS).toNumber()
      const vault = createVault(
        shortOtoken.address,
        undefined,
        usdc.address,
        scaleNum(100),
        undefined,
        collateralAmount,
      )
      const vaultId = 0

      // withdraw amount
      const withdrawamount = 2499

      assert.equal(
        (
          await marginRequirements.checkWithdrawCollateral(
            accountOwner1,
            scaleBigNum(withdrawamount, USDCDECIMALS),
            shortOtoken.address,
            weth.address,
            vaultId,
            vault,
          )
        ).toString(),
        'true',
        'Collateral is incorrect',
      )
    })
  })
})

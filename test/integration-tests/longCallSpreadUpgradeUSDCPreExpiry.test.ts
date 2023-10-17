import {
  MockERC20Instance,
  MarginCalculatorInstance,
  AddressBookInstance,
  MockOracleInstance,
  OtokenInstance,
  ControllerInstance,
  WhitelistInstance,
  MarginPoolInstance,
  OtokenFactoryInstance,
} from '../../build/types/truffle-types'
import {
  createTokenAmount,
  createValidExpiry,
  createScaledNumber as scaleNum,
  createScaledBigNumber as scaleBigNum,
  calcRelativeDiff,
} from '../utils'
import BigNumber from 'bignumber.js'

const { expectRevert, time } = require('@openzeppelin/test-helpers')
const AddressBook = artifacts.require('AddressBook.sol')
const MockOracle = artifacts.require('MockOracle.sol')
const Otoken = artifacts.require('Otoken.sol')
const MockERC20 = artifacts.require('MockERC20.sol')
const MarginCalculator = artifacts.require('MarginCalculator.sol')
const Whitelist = artifacts.require('Whitelist.sol')
const MarginPool = artifacts.require('MarginPool.sol')
const Controller = artifacts.require('Controller.sol')
const MarginVault = artifacts.require('MarginVault.sol')
const OTokenFactory = artifacts.require('OtokenFactory.sol')
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
}

contract('Long Call Spread Option with USDC collat closed before expiry flow', ([accountOwner1, nakedBuyer, accountOwner2]) => {
  let expiry: number

  let addressBook: AddressBookInstance
  let calculator: MarginCalculatorInstance
  let controllerProxy: ControllerInstance
  let controllerImplementation: ControllerInstance
  let marginPool: MarginPoolInstance
  let whitelist: WhitelistInstance
  let otokenImplementation: OtokenInstance
  let otokenFactory: OtokenFactoryInstance

  // oracle modulce mock
  let oracle: MockOracleInstance

  let usdc: MockERC20Instance
  let weth: MockERC20Instance

  let higherStrikeCall: OtokenInstance
  let lowerStrikeCall: OtokenInstance
  let higherStrikeCallUSD: OtokenInstance
  let lowerStrikeCallUSD: OtokenInstance
  let scaledUnderlyingPrice: BigNumber
  let scaledCollateralAmount: BigNumber

  const higherStrike = 200
  const lowerStrike = 100

  const optionsAmount = 10
  const collateralAmount = (Math.abs(lowerStrike - higherStrike) * optionsAmount) / lowerStrike

  let vaultCounter1: number
  let vaultCounter2: number

  const vaultType = web3.eth.abi.encodeParameter('uint256', 1)
  const usdcDecimals = 6
  const wethDecimals = 18
  const productSpotShockValue = scaleBigNum(0.75, 27)
  // array of time to expiry
  const day = 60 * 60 * 24
  const timeToExpiry = [day * 7, day * 14, day * 28, day * 42, day * 56]
  // array of upper bound value correspond to time to expiry
  const expiryToValue = [
    scaleNum(0.1678, 27),
    scaleNum(0.237, 27),
    scaleNum(0.3326, 27),
    scaleNum(0.4032, 27),
    scaleNum(0.4603, 27),
  ]
  const usdcDust = scaleNum(0.1, usdcDecimals)
  const usdcCap = scaleNum(500000, usdcDecimals)
  const oracleDeviation = 0.05
  const oracleDeviationValue = scaleNum(oracleDeviation, 27)

  before('set up contracts', async () => {
    const now = (await time.latest()).toNumber()
    expiry = createValidExpiry(now, 30)

    // setup usdc and weth
    usdc = await MockERC20.new('USDC', 'USDC', usdcDecimals)
    weth = await MockERC20.new('WETH', 'WETH', wethDecimals)

    // initiate addressbook first.
    addressBook = await AddressBook.new()
    // setup margin pool
    marginPool = await MarginPool.new(addressBook.address)
    // setup margin vault
    const lib = await MarginVault.new()
    // setup controllerProxy module
    await Controller.link('MarginVault', lib.address)
    controllerImplementation = await Controller.new(addressBook.address)
    // setup mock Oracle module
    oracle = await MockOracle.new(addressBook.address)
    // setup calculator
    calculator = await MarginCalculator.new(oracle.address, addressBook.address)
    // setup whitelist module
    whitelist = await Whitelist.new(addressBook.address)
    await whitelist.whitelistCollateral(weth.address)
    await whitelist.whitelistCollateral(usdc.address)
    await whitelist.whitelistCoveredCollateral(weth.address, weth.address, false)
    await whitelist.whitelistCoveredCollateral(usdc.address, weth.address, true)
    await whitelist.whitelistNakedCollateral(weth.address, weth.address, true)
    await whitelist.whitelistNakedCollateral(usdc.address, weth.address, false)
    whitelist.whitelistProduct(weth.address, usdc.address, usdc.address, true)
    whitelist.whitelistProduct(weth.address, usdc.address, weth.address, false)
    whitelist.whitelistProduct(weth.address, usdc.address, usdc.address, false)
    whitelist.whitelistProduct(weth.address, usdc.address, weth.address, true)
    // setup otoken
    otokenImplementation = await Otoken.new()
    // setup factory
    otokenFactory = await OTokenFactory.new(addressBook.address)

    // setup address book
    await addressBook.setOracle(oracle.address)
    await addressBook.setMarginCalculator(calculator.address)
    await addressBook.setWhitelist(whitelist.address)
    await addressBook.setMarginPool(marginPool.address)
    await addressBook.setOtokenFactory(otokenFactory.address)
    await addressBook.setOtokenImpl(otokenImplementation.address)
    await addressBook.setController(controllerImplementation.address)

    const controllerProxyAddress = await addressBook.getController()
    controllerProxy = await Controller.at(controllerProxyAddress)

    // configure controller
    await controllerProxy.setNakedCap(usdc.address, usdcCap)

    // config calculator
    await calculator.setSpotShock(weth.address, usdc.address, usdc.address, false, productSpotShockValue)
    await calculator.setOracleDeviation(oracleDeviationValue)
    await calculator.setCollateralDust(usdc.address, usdcDust)
    // set product upper bound values
    await calculator.setUpperBoundValues(weth.address, usdc.address, usdc.address, false, timeToExpiry, expiryToValue)

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      weth.address,
      createTokenAmount(lowerStrike, 8),
      expiry,
      false,
    )

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      weth.address,
      createTokenAmount(higherStrike, 8),
      expiry,
      false,
    )

    const lowerStrikeCallAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      weth.address,
      createTokenAmount(lowerStrike, 8),
      expiry,
      false,
    )

    lowerStrikeCall = await Otoken.at(lowerStrikeCallAddress)

    const higherStrikeCallAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      weth.address,
      createTokenAmount(higherStrike, 8),
      expiry,
      false,
    )

    higherStrikeCall = await Otoken.at(higherStrikeCallAddress)

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(lowerStrike),
      expiry,
      false,
    )

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(higherStrike, 8),
      expiry,
      false,
    )

    const lowerStrikeCallUSDAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(lowerStrike, 8),
      expiry,
      false,
    )

    lowerStrikeCallUSD = await Otoken.at(lowerStrikeCallUSDAddress)

    const higherStrikeCallUSDAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(higherStrike, 8),
      expiry,
      false,
    )

    higherStrikeCallUSD = await Otoken.at(higherStrikeCallUSDAddress)

    // mint weth to user
    const accountOwner1Weth = createTokenAmount(2 * collateralAmount, wethDecimals)
    const accountOwner2Weth = createTokenAmount(lowerStrike * optionsAmount, wethDecimals)
    const nakedBuyerWeth = createTokenAmount(lowerStrike * optionsAmount, wethDecimals)
    await weth.mint(accountOwner1, accountOwner1Weth)
    await weth.mint(accountOwner2, accountOwner2Weth)
    await weth.mint(nakedBuyer, nakedBuyerWeth)

    // have the user approve all the weth transfers
    await weth.approve(marginPool.address, accountOwner1Weth, { from: accountOwner1 })
    await weth.approve(marginPool.address, accountOwner2Weth, { from: accountOwner2 })
    await weth.approve(marginPool.address, nakedBuyerWeth, { from: nakedBuyer })

    // mint usdc to user
    const accountOwner1Usdc = createTokenAmount(1000000, usdcDecimals)
    const accountOwner2Usdc = createTokenAmount(1000000, usdcDecimals)
    const nakedBuyerUsdc = createTokenAmount(1000000, usdcDecimals)

    await usdc.mint(accountOwner1, accountOwner1Usdc)
    await usdc.mint(accountOwner2, accountOwner2Usdc)
    await usdc.mint(nakedBuyer, nakedBuyerUsdc)

    // have the user approve all the weth transfers
    await usdc.approve(marginPool.address, accountOwner1Usdc, { from: accountOwner1 })
    await usdc.approve(marginPool.address, accountOwner2Usdc, { from: accountOwner2 })
    await usdc.approve(marginPool.address, nakedBuyerWeth, { from: nakedBuyer })

    const vaultCounter1Before = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
    vaultCounter1 = vaultCounter1Before.toNumber() + 1
    const vaultCounter2Before = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner2))
    vaultCounter2 = vaultCounter2Before.toNumber() + 1
  })

  describe('Integration test: Open a long call spread and close it before expiry', () => {
    before('accountOwner2 mints the lower strike call option, sends it to accountOwner1', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
      const underlyingPrice = 200
      scaledUnderlyingPrice = scaleBigNum(underlyingPrice, 8)
      await oracle.setRealTimePrice(weth.address, scaledUnderlyingPrice)
      scaledCollateralAmount = await calculator.getNakedMarginRequired(
        weth.address,
        usdc.address,
        usdc.address,
        scaledOptionsAmount,
        createTokenAmount(lowerStrike, 8),
        scaledUnderlyingPrice,
        expiry,
        usdcDecimals,
        false,
      )

      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: ZERO_ADDR,
          vaultId: vaultCounter2,
          amount: '0',
          index: '0',
          data: vaultType,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: lowerStrikeCallUSD.address,
          vaultId: vaultCounter2,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: usdc.address,
          vaultId: vaultCounter2,
          amount: scaledCollateralAmount.toString(),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, { from: accountOwner2 })

      // accountOwner2 transfers their lower strike call option to accountOwner1
      await lowerStrikeCallUSD.transfer(accountOwner1, scaledOptionsAmount, { from: accountOwner2 })
    })
    it('accountOwner1 opens a long call spread', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)

      // Keep track of balances before
      const ownerWethBalanceBefore = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceBefore = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceBefore = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner1))
      const higherStrikeCallSupplyBefore = new BigNumber(await higherStrikeCallUSD.totalSupply())

      const ownerlongOtokenBalanceBefore = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner1))
      const lowerStrikeCallSupplyBefore = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      const marginPoolLongOtokenBalanceBefore = new BigNumber(await lowerStrikeCallUSD.balanceOf(marginPool.address))

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVaultWithDetails(accountOwner1, vaultCounter1)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultBefore[0].shortOtokens.length, 0, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(
        vaultBefore[0].collateralAssets.length,
        0,
        'Length of the collateral array in the vault is incorrect',
      )
      assert.equal(vaultBefore[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultBefore[0].shortAmounts.length, 0, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultBefore[0].collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultBefore[0].longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')

      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter1,
          amount: '0',
          index: '0',
          data: vaultType,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: higherStrikeCallUSD.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositLongOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: lowerStrikeCallUSD.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await lowerStrikeCallUSD.approve(marginPool.address, scaledOptionsAmount, { from: accountOwner1 })
      await controllerProxy.operate(actionArgs, { from: accountOwner1 })

      // keep track of balances after
      const ownerWethBalanceAfter = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceAfter = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerShortOtokenBalanceAfter = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner1))
      const higherStrikeCallSupplyAfter = new BigNumber(await higherStrikeCallUSD.totalSupply())

      const ownerlongOtokenBalanceAfter = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner1))
      const lowerStrikeCallSupplyAfter = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      const marginPoolLongOtokenBalanceAfter = new BigNumber(await lowerStrikeCallUSD.balanceOf(marginPool.address))

      // check balances before and after changed as expected
      assert.equal(ownerWethBalanceBefore.toString(), ownerWethBalanceAfter.toString())
      assert.equal(marginPoolWethBalanceBefore.toString(), marginPoolWethBalanceAfter.toString())
      assert.equal(ownerUsdcBalanceBefore.toString(), ownerUsdcBalanceAfter.toString())
      assert.equal(marginPoolUsdcBalanceBefore.toString(), marginPoolUsdcBalanceAfter.toString())
      assert.equal(
        ownerShortOtokenBalanceBefore.plus(scaledOptionsAmount).toString(),
        ownerShortOtokenBalanceAfter.toString(),
      )
      assert.equal(
        higherStrikeCallSupplyBefore.plus(scaledOptionsAmount).toString(),
        higherStrikeCallSupplyAfter.toString(),
      )

      assert.equal(
        ownerlongOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        ownerlongOtokenBalanceAfter.toString(),
      )
      assert.equal(lowerStrikeCallSupplyBefore.toString(), lowerStrikeCallSupplyAfter.toString())
      assert.equal(
        marginPoolLongOtokenBalanceBefore.plus(scaledOptionsAmount).toString(),
        marginPoolLongOtokenBalanceAfter.toString(),
      )

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVaultWithDetails(accountOwner1, vaultCounter1)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 0, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 1, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], higherStrikeCallUSD.address, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter[0].longOtokens[0], lowerStrikeCallUSD.address, 'Incorrect long otoken in the vault')

      assert.equal(vaultAfter[0].shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 1, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(
        vaultAfter[0].shortAmounts[0].toString(),
        scaledOptionsAmount,
        'Incorrect amount of short options stored in the vault',
      )
      assert.equal(
        vaultAfter[0].longAmounts[0].toString(),
        scaledOptionsAmount,
        'Incorrect amount of long options stored in the vault',
      )
    })

    it('accountOwner1 should be able to close out the long call spread position before expiry', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
      // Keep track of balances before
      const ownerWethBalanceBefore = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceBefore = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerShortOtokenBalanceBefore = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner1))
      const higherStrikeCallSupplyBefore = new BigNumber(await higherStrikeCallUSD.totalSupply())

      const ownerlongOtokenBalanceBefore = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner1))
      const lowerStrikeCallSupplyBefore = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      const marginPoolLongOtokenBalanceBefore = new BigNumber(await lowerStrikeCallUSD.balanceOf(marginPool.address))

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVaultWithDetails(accountOwner1, vaultCounter1)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.BurnShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: higherStrikeCallUSD.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.WithdrawLongOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: lowerStrikeCallUSD.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, { from: accountOwner1 })

      // keep track of balances after
      const ownerWethBalanceAfter = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceAfter = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceAfter = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner1))
      const higherStrikeCallSupplyAfter = new BigNumber(await higherStrikeCallUSD.totalSupply())

      const ownerlongOtokenBalanceAfter = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner1))
      const lowerStrikeCallSupplyAfter = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      const marginPoolLongOtokenBalanceAfter = new BigNumber(await lowerStrikeCallUSD.balanceOf(marginPool.address))

      // check balances before and after changed as expected
      assert.equal(ownerWethBalanceBefore.toString(), ownerWethBalanceAfter.toString())
      assert.equal(marginPoolWethBalanceBefore.toString(), marginPoolWethBalanceAfter.toString())
      assert.equal(ownerUsdcBalanceBefore.toString(), ownerUsdcBalanceAfter.toString())
      assert.equal(marginPoolUsdcBalanceBefore.toString(), marginPoolUsdcBalanceAfter.toString())
      assert.equal(
        ownerShortOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        ownerShortOtokenBalanceAfter.toString(),
      )
      assert.equal(
        higherStrikeCallSupplyBefore.minus(scaledOptionsAmount).toString(),
        higherStrikeCallSupplyAfter.toString(),
      )

      assert.equal(
        ownerlongOtokenBalanceBefore.plus(scaledOptionsAmount).toString(),
        ownerlongOtokenBalanceAfter.toString(),
      )
      assert.equal(lowerStrikeCallSupplyBefore.toString(), lowerStrikeCallSupplyAfter.toString())
      assert.equal(
        marginPoolLongOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        marginPoolLongOtokenBalanceAfter.toString(),
      )

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVaultWithDetails(accountOwner1, vaultCounter1)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 0, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 1, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], ZERO_ADDR, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter[0].longOtokens[0], ZERO_ADDR, 'Incorrect long otoken in the vault')

      assert.equal(vaultAfter[0].shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 1, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortAmounts[0].toString(), '0', 'Incorrect amount of short stored in the vault')
      assert.equal(vaultAfter[0].longAmounts[0].toString(), '0', 'Incorrect amount of long stored in the vault')
    })

    it('accountOwner2 should be able to close out the naked call position before expiry', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
      await lowerStrikeCallUSD.transfer(accountOwner2, scaledOptionsAmount, { from: accountOwner1 })
      // Keep track of balances before
      const ownerWethBalanceBefore = new BigNumber(await weth.balanceOf(accountOwner2))
      const marginPoolWethBalanceBefore = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner2))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceBefore = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner2))
      const lowerStrikeCallSupplyBefore = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      const marginPoolLowerStrikeCallBalanceBefore = new BigNumber(await lowerStrikeCallUSD.balanceOf(marginPool.address))

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVaultWithDetails(accountOwner2, vaultCounter2)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.BurnShortOption,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: lowerStrikeCallUSD.address,
          vaultId: vaultCounter2,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.WithdrawCollateral,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: usdc.address,
          vaultId: vaultCounter2,
          amount: scaledCollateralAmount.toString(),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, { from: accountOwner2 })

      // keep track of balances after
      const ownerWethBalanceAfter = new BigNumber(await weth.balanceOf(accountOwner2))
      const marginPoolWethBalanceAfter = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner2))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceAfter = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner2))
      const lowerStrikeCallSupplyAfter = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      const marginPoolLowerStrikeCallBalanceAfter = new BigNumber(await lowerStrikeCallUSD.balanceOf(marginPool.address))

      // check balances before and after changed as expected
      assert.equal(ownerWethBalanceBefore.toString(), ownerWethBalanceAfter.toString())
      assert.equal(
        marginPoolWethBalanceBefore.toString(),
        marginPoolWethBalanceAfter.toString(),
      )
      assert.equal(ownerUsdcBalanceBefore.plus(scaledCollateralAmount).toString(), ownerUsdcBalanceAfter.toString())
      assert.equal(
        marginPoolUsdcBalanceBefore.minus(scaledCollateralAmount).toString(),
        marginPoolUsdcBalanceAfter.toString(),
      )
      assert.equal(
        ownerShortOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        ownerShortOtokenBalanceAfter.toString(),
      )
      assert.equal(
        lowerStrikeCallSupplyBefore.minus(scaledOptionsAmount).toString(),
        lowerStrikeCallSupplyAfter.toString(),
      )
      assert.equal(marginPoolLowerStrikeCallBalanceBefore.toString(), marginPoolLowerStrikeCallBalanceAfter.toString())

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVaultWithDetails(accountOwner2, vaultCounter2)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], ZERO_ADDR, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter[0].collateralAssets[0], ZERO_ADDR, 'Incorrect collateral asset in the vault')

      assert.equal(vaultAfter[0].shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortAmounts[0].toString(), '0', 'Incorrect amount of short stored in the vault')
      assert.equal(
        vaultAfter[0].collateralAmounts[0].toString(),
        '0',
        'Incorrect amount of collateral stored in the vault',
      )
    })
  })
})

contract('Long Call Spread Option with USDC collat closed before expiry flow but just removes long', ([accountOwner1, nakedBuyer, accountOwner2]) => {
  let expiry: number

  let addressBook: AddressBookInstance
  let calculator: MarginCalculatorInstance
  let controllerProxy: ControllerInstance
  let controllerImplementation: ControllerInstance
  let marginPool: MarginPoolInstance
  let whitelist: WhitelistInstance
  let otokenImplementation: OtokenInstance
  let otokenFactory: OtokenFactoryInstance

  // oracle modulce mock
  let oracle: MockOracleInstance

  let usdc: MockERC20Instance
  let weth: MockERC20Instance

  let higherStrikeCall: OtokenInstance
  let lowerStrikeCall: OtokenInstance
  let higherStrikeCallUSD: OtokenInstance
  let lowerStrikeCallUSD: OtokenInstance
  let scaledUnderlyingPrice: BigNumber
  let scaledCollateralAmount: BigNumber

  const higherStrike = 200
  const lowerStrike = 100

  const optionsAmount = 10
  const collateralAmount = (Math.abs(lowerStrike - higherStrike) * optionsAmount) / lowerStrike

  let vaultCounter1: number
  let vaultCounter2: number

  const vaultType = web3.eth.abi.encodeParameter('uint256', 1)
  const usdcDecimals = 6
  const wethDecimals = 18
  const productSpotShockValue = scaleBigNum(0.75, 27)
  // array of time to expiry
  const day = 60 * 60 * 24
  const timeToExpiry = [day * 7, day * 14, day * 28, day * 42, day * 56]
  // array of upper bound value correspond to time to expiry
  const expiryToValue = [
    scaleNum(0.1678, 27),
    scaleNum(0.237, 27),
    scaleNum(0.3326, 27),
    scaleNum(0.4032, 27),
    scaleNum(0.4603, 27),
  ]
  const usdcDust = scaleNum(0.1, usdcDecimals)
  const usdcCap = scaleNum(500000, usdcDecimals)
  const oracleDeviation = 0.05
  const oracleDeviationValue = scaleNum(oracleDeviation, 27)

  before('set up contracts', async () => {
    const now = (await time.latest()).toNumber()
    expiry = createValidExpiry(now, 30)

    // setup usdc and weth
    usdc = await MockERC20.new('USDC', 'USDC', usdcDecimals)
    weth = await MockERC20.new('WETH', 'WETH', wethDecimals)

    // initiate addressbook first.
    addressBook = await AddressBook.new()
    // setup margin pool
    marginPool = await MarginPool.new(addressBook.address)
    // setup margin vault
    const lib = await MarginVault.new()
    // setup controllerProxy module
    await Controller.link('MarginVault', lib.address)
    controllerImplementation = await Controller.new(addressBook.address)
    // setup mock Oracle module
    oracle = await MockOracle.new(addressBook.address)
    // setup calculator
    calculator = await MarginCalculator.new(oracle.address, addressBook.address)
    // setup whitelist module
    whitelist = await Whitelist.new(addressBook.address)
    await whitelist.whitelistCollateral(weth.address)
    await whitelist.whitelistCollateral(usdc.address)
    await whitelist.whitelistCoveredCollateral(weth.address, weth.address, false)
    await whitelist.whitelistCoveredCollateral(usdc.address, weth.address, true)
    await whitelist.whitelistNakedCollateral(weth.address, weth.address, true)
    await whitelist.whitelistNakedCollateral(usdc.address, weth.address, false)
    whitelist.whitelistProduct(weth.address, usdc.address, usdc.address, true)
    whitelist.whitelistProduct(weth.address, usdc.address, weth.address, false)
    whitelist.whitelistProduct(weth.address, usdc.address, usdc.address, false)
    whitelist.whitelistProduct(weth.address, usdc.address, weth.address, true)
    // setup otoken
    otokenImplementation = await Otoken.new()
    // setup factory
    otokenFactory = await OTokenFactory.new(addressBook.address)

    // setup address book
    await addressBook.setOracle(oracle.address)
    await addressBook.setMarginCalculator(calculator.address)
    await addressBook.setWhitelist(whitelist.address)
    await addressBook.setMarginPool(marginPool.address)
    await addressBook.setOtokenFactory(otokenFactory.address)
    await addressBook.setOtokenImpl(otokenImplementation.address)
    await addressBook.setController(controllerImplementation.address)

    const controllerProxyAddress = await addressBook.getController()
    controllerProxy = await Controller.at(controllerProxyAddress)

    // configure controller
    await controllerProxy.setNakedCap(usdc.address, usdcCap)

    // config calculator
    await calculator.setSpotShock(weth.address, usdc.address, usdc.address, false, productSpotShockValue)
    await calculator.setOracleDeviation(oracleDeviationValue)
    await calculator.setCollateralDust(usdc.address, usdcDust)
    // set product upper bound values
    await calculator.setUpperBoundValues(weth.address, usdc.address, usdc.address, false, timeToExpiry, expiryToValue)

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      weth.address,
      createTokenAmount(lowerStrike, 8),
      expiry,
      false,
    )

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      weth.address,
      createTokenAmount(higherStrike, 8),
      expiry,
      false,
    )

    const lowerStrikeCallAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      weth.address,
      createTokenAmount(lowerStrike, 8),
      expiry,
      false,
    )

    lowerStrikeCall = await Otoken.at(lowerStrikeCallAddress)

    const higherStrikeCallAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      weth.address,
      createTokenAmount(higherStrike, 8),
      expiry,
      false,
    )

    higherStrikeCall = await Otoken.at(higherStrikeCallAddress)

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(lowerStrike),
      expiry,
      false,
    )

    await otokenFactory.createOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(higherStrike, 8),
      expiry,
      false,
    )

    const lowerStrikeCallUSDAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(lowerStrike, 8),
      expiry,
      false,
    )

    lowerStrikeCallUSD = await Otoken.at(lowerStrikeCallUSDAddress)

    const higherStrikeCallUSDAddress = await otokenFactory.getOtoken(
      weth.address,
      usdc.address,
      usdc.address,
      createTokenAmount(higherStrike, 8),
      expiry,
      false,
    )

    higherStrikeCallUSD = await Otoken.at(higherStrikeCallUSDAddress)

    // mint weth to user
    const accountOwner1Weth = createTokenAmount(2 * collateralAmount, wethDecimals)
    const accountOwner2Weth = createTokenAmount(lowerStrike * optionsAmount, wethDecimals)
    const nakedBuyerWeth = createTokenAmount(lowerStrike * optionsAmount, wethDecimals)
    await weth.mint(accountOwner1, accountOwner1Weth)
    await weth.mint(accountOwner2, accountOwner2Weth)
    await weth.mint(nakedBuyer, nakedBuyerWeth)

    // have the user approve all the weth transfers
    await weth.approve(marginPool.address, accountOwner1Weth, { from: accountOwner1 })
    await weth.approve(marginPool.address, accountOwner2Weth, { from: accountOwner2 })
    await weth.approve(marginPool.address, nakedBuyerWeth, { from: nakedBuyer })

    // mint usdc to user
    const accountOwner1Usdc = createTokenAmount(1000000, usdcDecimals)
    const accountOwner2Usdc = createTokenAmount(1000000, usdcDecimals)
    const nakedBuyerUsdc = createTokenAmount(1000000, usdcDecimals)

    await usdc.mint(accountOwner1, accountOwner1Usdc)
    await usdc.mint(accountOwner2, accountOwner2Usdc)
    await usdc.mint(nakedBuyer, nakedBuyerUsdc)

    // have the user approve all the weth transfers
    await usdc.approve(marginPool.address, accountOwner1Usdc, { from: accountOwner1 })
    await usdc.approve(marginPool.address, accountOwner2Usdc, { from: accountOwner2 })
    await usdc.approve(marginPool.address, nakedBuyerWeth, { from: nakedBuyer })

    const vaultCounter1Before = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner1))
    vaultCounter1 = vaultCounter1Before.toNumber() + 1
    const vaultCounter2Before = new BigNumber(await controllerProxy.getAccountVaultCounter(accountOwner2))
    vaultCounter2 = vaultCounter2Before.toNumber() + 1
  })

  describe('Integration test: Open a long call spread and close it before expiry', () => {
    before('accountOwner2 mints the lower strike call option, sends it to accountOwner1', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
      const underlyingPrice = 200
      scaledUnderlyingPrice = scaleBigNum(underlyingPrice, 8)
      await oracle.setRealTimePrice(weth.address, scaledUnderlyingPrice)
      scaledCollateralAmount = await calculator.getNakedMarginRequired(
        weth.address,
        usdc.address,
        usdc.address,
        scaledOptionsAmount,
        createTokenAmount(lowerStrike, 8),
        scaledUnderlyingPrice,
        expiry,
        usdcDecimals,
        false,
      )

      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: ZERO_ADDR,
          vaultId: vaultCounter2,
          amount: '0',
          index: '0',
          data: vaultType,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: lowerStrikeCallUSD.address,
          vaultId: vaultCounter2,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: usdc.address,
          vaultId: vaultCounter2,
          amount: scaledCollateralAmount.toString(),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, { from: accountOwner2 })

      // accountOwner2 transfers their lower strike call option to accountOwner1
      await lowerStrikeCallUSD.transfer(accountOwner1, scaledOptionsAmount, { from: accountOwner2 })
    })
    it('accountOwner1 opens a long call spread', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)

      // Keep track of balances before
      const ownerWethBalanceBefore = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceBefore = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceBefore = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner1))
      const higherStrikeCallSupplyBefore = new BigNumber(await higherStrikeCallUSD.totalSupply())

      const ownerlongOtokenBalanceBefore = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner1))
      const lowerStrikeCallSupplyBefore = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      const marginPoolLongOtokenBalanceBefore = new BigNumber(await lowerStrikeCallUSD.balanceOf(marginPool.address))

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVaultWithDetails(accountOwner1, vaultCounter1)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultBefore[0].shortOtokens.length, 0, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(
        vaultBefore[0].collateralAssets.length,
        0,
        'Length of the collateral array in the vault is incorrect',
      )
      assert.equal(vaultBefore[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultBefore[0].shortAmounts.length, 0, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultBefore[0].collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultBefore[0].longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')

      const actionArgs = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter1,
          amount: '0',
          index: '0',
          data: vaultType,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: higherStrikeCallUSD.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositLongOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: lowerStrikeCallUSD.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await lowerStrikeCallUSD.approve(marginPool.address, scaledOptionsAmount, { from: accountOwner1 })
      await controllerProxy.operate(actionArgs, { from: accountOwner1 })

      // keep track of balances after
      const ownerWethBalanceAfter = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceAfter = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerShortOtokenBalanceAfter = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner1))
      const higherStrikeCallSupplyAfter = new BigNumber(await higherStrikeCallUSD.totalSupply())

      const ownerlongOtokenBalanceAfter = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner1))
      const lowerStrikeCallSupplyAfter = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      const marginPoolLongOtokenBalanceAfter = new BigNumber(await lowerStrikeCallUSD.balanceOf(marginPool.address))

      // check balances before and after changed as expected
      assert.equal(ownerWethBalanceBefore.toString(), ownerWethBalanceAfter.toString())
      assert.equal(marginPoolWethBalanceBefore.toString(), marginPoolWethBalanceAfter.toString())
      assert.equal(ownerUsdcBalanceBefore.toString(), ownerUsdcBalanceAfter.toString())
      assert.equal(marginPoolUsdcBalanceBefore.toString(), marginPoolUsdcBalanceAfter.toString())
      assert.equal(
        ownerShortOtokenBalanceBefore.plus(scaledOptionsAmount).toString(),
        ownerShortOtokenBalanceAfter.toString(),
      )
      assert.equal(
        higherStrikeCallSupplyBefore.plus(scaledOptionsAmount).toString(),
        higherStrikeCallSupplyAfter.toString(),
      )

      assert.equal(
        ownerlongOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        ownerlongOtokenBalanceAfter.toString(),
      )
      assert.equal(lowerStrikeCallSupplyBefore.toString(), lowerStrikeCallSupplyAfter.toString())
      assert.equal(
        marginPoolLongOtokenBalanceBefore.plus(scaledOptionsAmount).toString(),
        marginPoolLongOtokenBalanceAfter.toString(),
      )

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVaultWithDetails(accountOwner1, vaultCounter1)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 0, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 1, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], higherStrikeCallUSD.address, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter[0].longOtokens[0], lowerStrikeCallUSD.address, 'Incorrect long otoken in the vault')

      assert.equal(vaultAfter[0].shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 1, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(
        vaultAfter[0].shortAmounts[0].toString(),
        scaledOptionsAmount,
        'Incorrect amount of short options stored in the vault',
      )
      assert.equal(
        vaultAfter[0].longAmounts[0].toString(),
        scaledOptionsAmount,
        'Incorrect amount of long options stored in the vault',
      )
    })
    it('FAILS: accountOwner1 closes long call spread without recollateralising', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
      // Keep track of balances before

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVaultWithDetails(accountOwner1, vaultCounter1)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.WithdrawLongOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: lowerStrikeCallUSD.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        }
      ]

      await expectRevert(controllerProxy.operate(actionArgs, { from: accountOwner1 }), "C14")

    })

    it('accountOwner1 should be able to close out the long call spread position before expiry', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
      const collateralAmount = await calculator.getNakedMarginRequired(
        weth.address,
        usdc.address,
        usdc.address,
        scaledOptionsAmount,
        createTokenAmount(higherStrike, 8),
        scaledUnderlyingPrice,
        expiry,
        usdcDecimals,
        false,
      )
      // Keep track of balances before
      const ownerWethBalanceBefore = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceBefore = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerShortOtokenBalanceBefore = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner1))
      const higherStrikeCallSupplyBefore = new BigNumber(await higherStrikeCallUSD.totalSupply())

      const ownerlongOtokenBalanceBefore = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner1))
      const lowerStrikeCallSupplyBefore = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      const marginPoolLongOtokenBalanceBefore = new BigNumber(await lowerStrikeCallUSD.balanceOf(marginPool.address))

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVaultWithDetails(accountOwner1, vaultCounter1)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.WithdrawLongOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: lowerStrikeCallUSD.address,
          vaultId: vaultCounter1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: usdc.address,
          vaultId: vaultCounter1,
          amount: collateralAmount.toString(),
          index: '0',
          data: ZERO_ADDR,
        }
      ]

      await controllerProxy.operate(actionArgs, { from: accountOwner1 })

      // keep track of balances after
      const ownerWethBalanceAfter = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceAfter = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceAfter = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner1))
      const higherStrikeCallSupplyAfter = new BigNumber(await higherStrikeCallUSD.totalSupply())

      const ownerlongOtokenBalanceAfter = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner1))
      const lowerStrikeCallSupplyAfter = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      const marginPoolLongOtokenBalanceAfter = new BigNumber(await lowerStrikeCallUSD.balanceOf(marginPool.address))

      // check balances before and after changed as expected
      assert.equal(ownerWethBalanceBefore.toString(), ownerWethBalanceAfter.toString())
      assert.equal(marginPoolWethBalanceBefore.toString(), marginPoolWethBalanceAfter.toString())
      assert.equal(ownerUsdcBalanceBefore.minus(collateralAmount).toString(), ownerUsdcBalanceAfter.toString())
      assert.equal(marginPoolUsdcBalanceBefore.plus(collateralAmount).toString(), marginPoolUsdcBalanceAfter.toString())
      assert.equal(
        ownerShortOtokenBalanceBefore.toString(),
        ownerShortOtokenBalanceAfter.toString(),
      )
      assert.equal(
        higherStrikeCallSupplyBefore.toString(),
        higherStrikeCallSupplyAfter.toString(),
      )
      assert.equal(
        ownerlongOtokenBalanceBefore.plus(scaledOptionsAmount).toString(),
        ownerlongOtokenBalanceAfter.toString(),
      )
      assert.equal(lowerStrikeCallSupplyBefore.toString(), lowerStrikeCallSupplyAfter.toString())
      assert.equal(
        marginPoolLongOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        marginPoolLongOtokenBalanceAfter.toString(),
      )

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVaultWithDetails(accountOwner1, vaultCounter1)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 1, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], higherStrikeCallUSD.address, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter[0].longOtokens[0], ZERO_ADDR, 'Incorrect long otoken in the vault')

      assert.equal(vaultAfter[0].shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 1, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortAmounts[0].toString(), scaledOptionsAmount, 'Incorrect amount of short stored in the vault')
      assert.equal(vaultAfter[0].longAmounts[0].toString(), '0', 'Incorrect amount of long stored in the vault')
    })

    it('accountOwner2 should be able to close out the naked call position before expiry', async () => {
      const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
      await lowerStrikeCallUSD.transfer(accountOwner2, scaledOptionsAmount, { from: accountOwner1 })
      // Keep track of balances before
      const ownerWethBalanceBefore = new BigNumber(await weth.balanceOf(accountOwner2))
      const marginPoolWethBalanceBefore = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner2))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceBefore = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner2))
      const lowerStrikeCallSupplyBefore = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      const marginPoolLowerStrikeCallBalanceBefore = new BigNumber(await lowerStrikeCallUSD.balanceOf(marginPool.address))

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVaultWithDetails(accountOwner2, vaultCounter2)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.BurnShortOption,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: lowerStrikeCallUSD.address,
          vaultId: vaultCounter2,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.WithdrawCollateral,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: usdc.address,
          vaultId: vaultCounter2,
          amount: scaledCollateralAmount.toString(),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, { from: accountOwner2 })

      // keep track of balances after
      const ownerWethBalanceAfter = new BigNumber(await weth.balanceOf(accountOwner2))
      const marginPoolWethBalanceAfter = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner2))
      const marginPoolUsdcBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerShortOtokenBalanceAfter = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner2))
      const lowerStrikeCallSupplyAfter = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      const marginPoolLowerStrikeCallBalanceAfter = new BigNumber(await lowerStrikeCallUSD.balanceOf(marginPool.address))

      // check balances before and after changed as expected
      assert.equal(ownerWethBalanceBefore.toString(), ownerWethBalanceAfter.toString())
      assert.equal(
        marginPoolWethBalanceBefore.toString(),
        marginPoolWethBalanceAfter.toString(),
      )
      assert.equal(ownerUsdcBalanceBefore.plus(scaledCollateralAmount).toString(), ownerUsdcBalanceAfter.toString())
      assert.equal(
        marginPoolUsdcBalanceBefore.minus(scaledCollateralAmount).toString(),
        marginPoolUsdcBalanceAfter.toString(),
      )
      assert.equal(
        ownerShortOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        ownerShortOtokenBalanceAfter.toString(),
      )
      assert.equal(
        lowerStrikeCallSupplyBefore.minus(scaledOptionsAmount).toString(),
        lowerStrikeCallSupplyAfter.toString(),
      )
      assert.equal(marginPoolLowerStrikeCallBalanceBefore.toString(), marginPoolLowerStrikeCallBalanceAfter.toString())

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVaultWithDetails(accountOwner2, vaultCounter2)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 1, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 1, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortOtokens[0], ZERO_ADDR, 'Incorrect short otoken in the vault')
      assert.equal(vaultAfter[0].collateralAssets[0], ZERO_ADDR, 'Incorrect collateral asset in the vault')

      assert.equal(vaultAfter[0].shortAmounts.length, 1, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        1,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortAmounts[0].toString(), '0', 'Incorrect amount of short stored in the vault')
      assert.equal(
        vaultAfter[0].collateralAmounts[0].toString(),
        '0',
        'Incorrect amount of collateral stored in the vault',
      )
    })
  })
})

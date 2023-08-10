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
  createScaledNumber as scaleNum
  createScaledBigNumber as scaleBigNum,
  calcRelativeDiff,
} from '../utils'
import BigNumber from 'bignumber.js'
const { expectRevert } = require('@openzeppelin/test-helpers')
const { time } = require('@openzeppelin/test-helpers')
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

contract('Long Call Spread Option expires Itm flow', ([accountOwner1, nakedBuyer, accountOwner2]) => {
  let expiry: number
  let scaledUnderlyingPrice: BigNumber
  let scaledCollateralAmount: BigNumber
  
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
  // should succeed to set up call debit spread with weth collat
  // should fail to set up call debit spread with weth and usdc collat
  // should succeed to set up call debit spread with usdc collat - done
  // should fail to set up call debit spread with usdc and weth collat
  // call debit spread with weth collat should payout when expires itm
  // call debit spread with weth collat should not payout when expires otm
  // call debit spread with usdc collat should payout when expires itm
  // call debit spread with usdc collat should not payout when expires otm
  // call debit spread should payout correctly if expires in between
  // removing long position early should result in correct collateral value for weth collat
  // removing long position early should result in correct collateral value for usdc collat
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
      createTokenAmount(lowerStrike),
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

  describe('Integration test: Close a long call spread collateralised with usdc after it expires ITM', () => {
    const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
    const expirySpotPrice = 250
    before(
      'accountOwner2 mints the lower strike call option, sends it to accountOwner1. accountOwner1 opens a long call spread',
      async () => {
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
        const actionArgsAccountOwner2 = [
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
        await controllerProxy.operate(actionArgsAccountOwner2, { from: accountOwner2 })
        // accountOwner2 transfers their lower strike Call option to accountOwner1
        await lowerStrikeCallUSD.transfer(accountOwner1, scaledOptionsAmount, { from: accountOwner2 })
  
        const actionArgsAccountOwner1 = [
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
        await controllerProxy.operate(actionArgsAccountOwner1, { from: accountOwner1 })

      },)

    it('FAILS: accountOwner1: tries to open a long call spread with a mixture of weth and usdc collat', async () => {
      const actionArgsAccountOwner2 = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: ZERO_ADDR,
          vaultId: vaultCounter2 + 1,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: lowerStrikeCall.address,
          vaultId: vaultCounter2 + 1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositCollateral,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: weth.address,
          vaultId: vaultCounter2 + 1,
          amount: createTokenAmount(optionsAmount, wethDecimals),
          index: '0',
          data: ZERO_ADDR,
        },
      ]
      await controllerProxy.operate(actionArgsAccountOwner2, { from: accountOwner2 })
      // accountOwner2 transfers their lower strike Call option to accountOwner1
      await lowerStrikeCall.transfer(accountOwner1, scaledOptionsAmount, { from: accountOwner2 })
      const actionArgsAccountOwner1 = [
        {
          actionType: ActionType.OpenVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter1 + 1,
          amount: '0',
          index: '0',
          data: vaultType,
        },
        {
          actionType: ActionType.MintShortOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: higherStrikeCallUSD.address,
          vaultId: vaultCounter1 + 1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
        {
          actionType: ActionType.DepositLongOption,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: lowerStrikeCall.address,
          vaultId: vaultCounter1 + 1,
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]
      await lowerStrikeCall.approve(marginPool.address, scaledOptionsAmount, { from: accountOwner1 })
      await expectRevert(controllerProxy.operate(actionArgsAccountOwner1, { from: accountOwner1 }), "MarginCalculator: long asset not marginable for short asset" )
    })
    it('accountOwner1: close an ITM long call spread position after expiry', async () => {
      // Keep track of balances before
      const ownerWethBalanceBefore = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceBefore = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerShortOtokenBalanceBefore = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner1))
      const shortOtokenSupplyBefore = new BigNumber(await higherStrikeCallUSD.totalSupply())
      const ownerLongOtokenBalanceBefore = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner1))
      const longOtokenSupplyBefore = new BigNumber(await lowerStrikeCallUSD.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVaultWithDetails(accountOwner1, vaultCounter1)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      // Set the oracle price
      if ((await time.latest()) < expiry) {
        await time.increaseTo(expiry + 2)
      }
      const strikePriceChange = Math.min(expirySpotPrice - lowerStrike, higherStrike - lowerStrike)
      const scaledETHPrice = createTokenAmount(expirySpotPrice, 8)
      const scaledUSDCPrice = createTokenAmount(1)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, scaledETHPrice, true)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, scaledUSDCPrice, true)

      const collateralPayout = Math.max(strikePriceChange * (optionsAmount), 0)

      // Check that after expiry, the vault excess balance has updated as expected
      const vaultStateBeforeSettlement = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])

      assert.equal(
        new BigNumber(vaultStateBeforeSettlement[0]).toString(),
        createTokenAmount(collateralPayout, usdcDecimals),
      )
      assert.equal(vaultStateBeforeSettlement[1], true)

      const actionArgs = [
        {
          actionType: ActionType.SettleVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter1,
          amount: '0',
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
      const shortOtokenSupplyAfter = new BigNumber(await higherStrikeCallUSD.totalSupply())
      const ownerLongOtokenBalanceAfter = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner1))
      const longOtokenSupplyAfter = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      // check balances before and after changed as expected
      assert.equal(
        ownerUsdcBalanceBefore.plus(createTokenAmount(collateralPayout, usdcDecimals)).toString(),
        ownerUsdcBalanceAfter.toString(),
        'usdc balance mismatch',
      )
      assert.equal(
        marginPoolUsdcBalanceBefore.minus(createTokenAmount(collateralPayout,usdcDecimals)).toString(),
        marginPoolUsdcBalanceAfter.toString(),
        'pool usdc balance mismatch',
      )
      assert.equal(ownerShortOtokenBalanceBefore.toString(), ownerShortOtokenBalanceAfter.toString())
      assert.equal(shortOtokenSupplyBefore.toString(), shortOtokenSupplyAfter.toString())

      assert.equal(ownerLongOtokenBalanceBefore.toString(), ownerLongOtokenBalanceAfter.toString())
      assert.equal(longOtokenSupplyBefore.minus(scaledOptionsAmount).toString(), longOtokenSupplyAfter.toString())

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVaultWithDetails(accountOwner1, vaultCounter1)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 0, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 0, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortAmounts.length, 0, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')
    })

    it('nakedBuyer: redeem the higher strike ITM call option after expiry', async () => {
      // accountOwner1 transfers their higher strike call option to the nakedBuyer
      await higherStrikeCallUSD.transfer(nakedBuyer, scaledOptionsAmount, { from: accountOwner1 })
      // oracle orice increases
      const strikePriceChange = Math.max(0, expirySpotPrice - higherStrike)

      // Keep track of balances before
      const nakedBuyerUsdBalanceBefore = new BigNumber(await usdc.balanceOf(nakedBuyer))
      const marginPoolUsdBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerOtokenBalanceBefore = new BigNumber(await higherStrikeCallUSD.balanceOf(nakedBuyer))
      const OtokenSupplyBefore = new BigNumber(await higherStrikeCallUSD.totalSupply())

      const actionArgs = [
        {
          actionType: ActionType.Redeem,
          owner: nakedBuyer,
          secondAddress: nakedBuyer,
          asset: higherStrikeCallUSD.address,
          vaultId: '0',
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, { from: nakedBuyer })

      // keep track of balances after
      const nakedBuyerUsdBalanceAfter = new BigNumber(await usdc.balanceOf(nakedBuyer))
      const marginPoolUsdBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerOtokenBalanceAfter = new BigNumber(await higherStrikeCallUSD.balanceOf(nakedBuyer))
      const OtokenSupplyAfter = new BigNumber(await higherStrikeCallUSD.totalSupply())

      const payout = (strikePriceChange * optionsAmount) 
      const scaledPayoutAmount = createTokenAmount(payout, usdcDecimals)

      // check balances before and after changed as expected
      assert.equal(
        nakedBuyerUsdBalanceBefore.plus(scaledPayoutAmount).toString(),
        nakedBuyerUsdBalanceAfter.toString(),
        'owner usdc balance mismatch',
      )
      assert.equal(
        marginPoolUsdBalanceBefore.minus(scaledPayoutAmount).toString(),
        marginPoolUsdBalanceAfter.toString(),
        'pool usd balance mismatch',
      )
      assert.equal(
        ownerOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        ownerOtokenBalanceAfter.toString(),
        'owner otoken balance mismatch',
      )
      assert.equal(
        OtokenSupplyBefore.minus(scaledOptionsAmount).toString(),
        OtokenSupplyAfter.toString(),
        'pool otoken balance mismatch',
      )
    })

    it('accountOwner2: close an ITM short call position after expiry', async () => {
      // oracle orice increases
      const strikePriceChange = Math.max(0, expirySpotPrice - lowerStrike)
      const payoutAmount = new BigNumber(scaledCollateralAmount).minus(new BigNumber(createTokenAmount(optionsAmount * strikePriceChange, 6)))
      scaledCollateralAmount = payoutAmount

      // Keep track of balances before
      const ownerUsdBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner2))
      const marginPoolUsdBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerHigherStrikeCallBalanceBefore = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner2))
      const ownerLowerStrikeCallBalanceBefore = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner2))
      const higherStrikeCallSupplyBefore = new BigNumber(await higherStrikeCallUSD.totalSupply())
      const lowerStrikeCallSupplyBefore = new BigNumber(await lowerStrikeCallUSD.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVaultWithDetails(accountOwner2, vaultCounter2)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), scaledCollateralAmount.toString())
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.SettleVault,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: ZERO_ADDR,
          vaultId: vaultCounter2,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, { from: accountOwner2 })

      // keep track of balances after
      const ownerUsdBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner2))
      const marginPoolUsdBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerHigherStrikeCallBalanceAfter = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner2))
      const ownerLowerStrikeCallBalanceAfter = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner2))
      const higherStrikeCallSupplyAfter = new BigNumber(await higherStrikeCallUSD.totalSupply())
      const lowerStrikeCallSupplyAfter = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      // check balances before and after changed as expected
      assert.equal(ownerUsdBalanceBefore.plus(scaledCollateralAmount).toString(), ownerUsdBalanceAfter.toString())
      assert.equal(
        marginPoolUsdBalanceBefore.minus(scaledCollateralAmount).toString(),
        marginPoolUsdBalanceAfter.toString(),
      )
      assert.equal(ownerHigherStrikeCallBalanceBefore.toString(), ownerHigherStrikeCallBalanceAfter.toString())
      assert.equal(ownerLowerStrikeCallBalanceBefore.toString(), ownerLowerStrikeCallBalanceAfter.toString())
      assert.equal(higherStrikeCallSupplyBefore.toString(), higherStrikeCallSupplyAfter.toString())
      assert.equal(lowerStrikeCallSupplyBefore.toString(), lowerStrikeCallSupplyAfter.toString())
      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVaultWithDetails(accountOwner2, vaultCounter2)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 0, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 0, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortAmounts.length, 0, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')
    })
  })
})

contract('Long Call Spread Option expires Itm flow swap high strike and low strike', ([accountOwner1, nakedBuyer, accountOwner2]) => {
  let expiry: number
  let scaledUnderlyingPrice: BigNumber
  let scaledCollateralAmount: BigNumber
  
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

  const higherStrike = 100
  const lowerStrike = 200

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
  // should succeed to set up call debit spread with weth collat
  // should fail to set up call debit spread with weth and usdc collat
  // should succeed to set up call debit spread with usdc collat - done
  // should fail to set up call debit spread with usdc and weth collat
  // call debit spread with weth collat should payout when expires itm
  // call debit spread with weth collat should not payout when expires otm
  // call debit spread with usdc collat should payout when expires itm
  // call debit spread with usdc collat should not payout when expires otm
  // call debit spread should payout correctly if expires in between
  // removing long position early should result in correct collateral value for weth collat
  // removing long position early should result in correct collateral value for usdc collat
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
      createTokenAmount(lowerStrike),
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

  describe('Integration test: Close a long call spread collateralised with usdc after it expires ITM', () => {
    const scaledOptionsAmount = createTokenAmount(optionsAmount, 8)
    const expirySpotPrice = 250
    before(
      'accountOwner2 mints the lower strike call option, sends it to accountOwner1. accountOwner1 opens a long call spread',
      async () => {
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
        const actionArgsAccountOwner2 = [
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
        await controllerProxy.operate(actionArgsAccountOwner2, { from: accountOwner2 })
        // accountOwner2 transfers their lower strike Call option to accountOwner1
        await lowerStrikeCallUSD.transfer(accountOwner1, scaledOptionsAmount, { from: accountOwner2 })
        const spreadCollatAmount = createTokenAmount((lowerStrike - higherStrike) * optionsAmount, 6)
        const actionArgsAccountOwner1 = [
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
          {
            actionType: ActionType.DepositCollateral,
            owner: accountOwner1,
            secondAddress: accountOwner1,
            asset: usdc.address,
            vaultId: vaultCounter1,
            amount: spreadCollatAmount.toString(),
            index: '0',
            data: ZERO_ADDR,
          },
        ]
        await lowerStrikeCallUSD.approve(marginPool.address, scaledOptionsAmount, { from: accountOwner1 })
        await controllerProxy.operate(actionArgsAccountOwner1, { from: accountOwner1 })
      },
    )
    it('accountOwner1: close an ITM long call spread position after expiry', async () => {
      // Keep track of balances before
      const ownerWethBalanceBefore = new BigNumber(await weth.balanceOf(accountOwner1))
      const marginPoolWethBalanceBefore = new BigNumber(await weth.balanceOf(marginPool.address))
      const ownerUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner1))
      const marginPoolUsdcBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerShortOtokenBalanceBefore = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner1))
      const shortOtokenSupplyBefore = new BigNumber(await higherStrikeCallUSD.totalSupply())
      const ownerLongOtokenBalanceBefore = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner1))
      const longOtokenSupplyBefore = new BigNumber(await lowerStrikeCallUSD.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVaultWithDetails(accountOwner1, vaultCounter1)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), '0')
      assert.equal(vaultStateBefore[1], true)

      // Set the oracle price
      if ((await time.latest()) < expiry) {
        await time.increaseTo(expiry + 2)
      }
      const strikePriceChange = Math.min(expirySpotPrice - lowerStrike, higherStrike - lowerStrike)
      const scaledETHPrice = createTokenAmount(expirySpotPrice, 8)
      const scaledUSDCPrice = createTokenAmount(1)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, scaledETHPrice, true)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, scaledUSDCPrice, true)

      const collateralPayout = Math.max(strikePriceChange * (optionsAmount), 0)

      // Check that after expiry, the vault excess balance has updated as expected
      const vaultStateBeforeSettlement = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])

      assert.equal(
        new BigNumber(vaultStateBeforeSettlement[0]).toString(),
        createTokenAmount(collateralPayout, usdcDecimals),
      )
      assert.equal(vaultStateBeforeSettlement[1], true)

      const actionArgs = [
        {
          actionType: ActionType.SettleVault,
          owner: accountOwner1,
          secondAddress: accountOwner1,
          asset: ZERO_ADDR,
          vaultId: vaultCounter1,
          amount: '0',
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
      const shortOtokenSupplyAfter = new BigNumber(await higherStrikeCallUSD.totalSupply())
      const ownerLongOtokenBalanceAfter = new BigNumber(await lowerStrikeCallUSD.balanceOf(accountOwner1))
      const longOtokenSupplyAfter = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      // check balances before and after changed as expected
      assert.equal(
        ownerUsdcBalanceBefore.plus(createTokenAmount(collateralPayout, usdcDecimals)).toString(),
        ownerUsdcBalanceAfter.toString(),
        'usdc balance mismatch',
      )
      assert.equal(
        marginPoolUsdcBalanceBefore.minus(createTokenAmount(collateralPayout,usdcDecimals)).toString(),
        marginPoolUsdcBalanceAfter.toString(),
        'pool usdc balance mismatch',
      )
      assert.equal(ownerShortOtokenBalanceBefore.toString(), ownerShortOtokenBalanceAfter.toString())
      assert.equal(shortOtokenSupplyBefore.toString(), shortOtokenSupplyAfter.toString())

      assert.equal(ownerLongOtokenBalanceBefore.toString(), ownerLongOtokenBalanceAfter.toString())
      assert.equal(longOtokenSupplyBefore.minus(scaledOptionsAmount).toString(), longOtokenSupplyAfter.toString())

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVaultWithDetails(accountOwner1, vaultCounter1)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 0, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 0, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortAmounts.length, 0, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')
    })

    it('nakedBuyer: redeem the higher strike ITM call option after expiry', async () => {
      // accountOwner1 transfers their higher strike call option to the nakedBuyer
      await higherStrikeCallUSD.transfer(nakedBuyer, scaledOptionsAmount, { from: accountOwner1 })
      // oracle orice increases
      const strikePriceChange = Math.max(0, expirySpotPrice - higherStrike)

      // Keep track of balances before
      const nakedBuyerUsdBalanceBefore = new BigNumber(await usdc.balanceOf(nakedBuyer))
      const marginPoolUsdBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerOtokenBalanceBefore = new BigNumber(await higherStrikeCallUSD.balanceOf(nakedBuyer))
      const OtokenSupplyBefore = new BigNumber(await higherStrikeCallUSD.totalSupply())

      const actionArgs = [
        {
          actionType: ActionType.Redeem,
          owner: nakedBuyer,
          secondAddress: nakedBuyer,
          asset: higherStrikeCallUSD.address,
          vaultId: '0',
          amount: scaledOptionsAmount,
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, { from: nakedBuyer })

      // keep track of balances after
      const nakedBuyerUsdBalanceAfter = new BigNumber(await usdc.balanceOf(nakedBuyer))
      const marginPoolUsdBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerOtokenBalanceAfter = new BigNumber(await higherStrikeCallUSD.balanceOf(nakedBuyer))
      const OtokenSupplyAfter = new BigNumber(await higherStrikeCallUSD.totalSupply())

      const payout = (strikePriceChange * optionsAmount) 
      const scaledPayoutAmount = createTokenAmount(payout, usdcDecimals)

      // check balances before and after changed as expected
      assert.equal(
        nakedBuyerUsdBalanceBefore.plus(scaledPayoutAmount).toString(),
        nakedBuyerUsdBalanceAfter.toString(),
        'owner usdc balance mismatch',
      )
      assert.equal(
        marginPoolUsdBalanceBefore.minus(scaledPayoutAmount).toString(),
        marginPoolUsdBalanceAfter.toString(),
        'pool usd balance mismatch',
      )
      assert.equal(
        ownerOtokenBalanceBefore.minus(scaledOptionsAmount).toString(),
        ownerOtokenBalanceAfter.toString(),
        'owner otoken balance mismatch',
      )
      assert.equal(
        OtokenSupplyBefore.minus(scaledOptionsAmount).toString(),
        OtokenSupplyAfter.toString(),
        'pool otoken balance mismatch',
      )
    })

    it('accountOwner2: close an ITM short call position after expiry', async () => {
      // oracle orice increases
      const strikePriceChange = Math.max(0, expirySpotPrice - lowerStrike)
      const payoutAmount = new BigNumber(scaledCollateralAmount).minus(new BigNumber(createTokenAmount(optionsAmount * strikePriceChange, 6)))
      scaledCollateralAmount = payoutAmount

      // Keep track of balances before
      const ownerUsdBalanceBefore = new BigNumber(await usdc.balanceOf(accountOwner2))
      const marginPoolUsdBalanceBefore = new BigNumber(await usdc.balanceOf(marginPool.address))
      const ownerHigherStrikeCallBalanceBefore = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner2))
      const ownerLowerStrikeCallBalanceBefore = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner2))
      const higherStrikeCallSupplyBefore = new BigNumber(await higherStrikeCallUSD.totalSupply())
      const lowerStrikeCallSupplyBefore = new BigNumber(await lowerStrikeCallUSD.totalSupply())

      // Check that we start at a valid state
      const vaultBefore = await controllerProxy.getVaultWithDetails(accountOwner2, vaultCounter2)
      const vaultStateBefore = await calculator.getExcessCollateral(vaultBefore[0], vaultBefore[1])
      assert.equal(vaultStateBefore[0].toString(), scaledCollateralAmount.toString())
      assert.equal(vaultStateBefore[1], true)

      const actionArgs = [
        {
          actionType: ActionType.SettleVault,
          owner: accountOwner2,
          secondAddress: accountOwner2,
          asset: ZERO_ADDR,
          vaultId: vaultCounter2,
          amount: '0',
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      await controllerProxy.operate(actionArgs, { from: accountOwner2 })

      // keep track of balances after
      const ownerUsdBalanceAfter = new BigNumber(await usdc.balanceOf(accountOwner2))
      const marginPoolUsdBalanceAfter = new BigNumber(await usdc.balanceOf(marginPool.address))

      const ownerHigherStrikeCallBalanceAfter = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner2))
      const ownerLowerStrikeCallBalanceAfter = new BigNumber(await higherStrikeCallUSD.balanceOf(accountOwner2))
      const higherStrikeCallSupplyAfter = new BigNumber(await higherStrikeCallUSD.totalSupply())
      const lowerStrikeCallSupplyAfter = new BigNumber(await lowerStrikeCallUSD.totalSupply())
      // check balances before and after changed as expected
      assert.equal(ownerUsdBalanceBefore.plus(scaledCollateralAmount).toString(), ownerUsdBalanceAfter.toString())
      assert.equal(
        marginPoolUsdBalanceBefore.minus(scaledCollateralAmount).toString(),
        marginPoolUsdBalanceAfter.toString(),
      )
      assert.equal(ownerHigherStrikeCallBalanceBefore.toString(), ownerHigherStrikeCallBalanceAfter.toString())
      assert.equal(ownerLowerStrikeCallBalanceBefore.toString(), ownerLowerStrikeCallBalanceAfter.toString())
      assert.equal(higherStrikeCallSupplyBefore.toString(), higherStrikeCallSupplyAfter.toString())
      assert.equal(lowerStrikeCallSupplyBefore.toString(), lowerStrikeCallSupplyAfter.toString())

      // Check that we end at a valid state
      const vaultAfter = await controllerProxy.getVaultWithDetails(accountOwner2, vaultCounter2)
      const vaultStateAfter = await calculator.getExcessCollateral(vaultAfter[0], vaultAfter[1])
      assert.equal(vaultStateAfter[0].toString(), '0')
      assert.equal(vaultStateAfter[1], true)

      // Check the vault balances stored in the contract
      assert.equal(vaultAfter[0].shortOtokens.length, 0, 'Length of the short otoken array in the vault is incorrect')
      assert.equal(vaultAfter[0].collateralAssets.length, 0, 'Length of the collateral array in the vault is incorrect')
      assert.equal(vaultAfter[0].longOtokens.length, 0, 'Length of the long otoken array in the vault is incorrect')

      assert.equal(vaultAfter[0].shortAmounts.length, 0, 'Length of the short amounts array in the vault is incorrect')
      assert.equal(
        vaultAfter[0].collateralAmounts.length,
        0,
        'Length of the collateral amounts array in the vault is incorrect',
      )
      assert.equal(vaultAfter[0].longAmounts.length, 0, 'Length of the long amounts array in the vault is incorrect')
    })
  })
})
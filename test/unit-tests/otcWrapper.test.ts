import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'
import { id } from 'ethers/lib/utils'
import {
  MarginCalculatorInstance,
  MockOtokenInstance,
  MockERC20Instance,
  MockOracleInstance,
  MockWhitelistModuleInstance,
  MarginPoolInstance,
  ControllerInstance,
  AddressBookInstance,
  OwnedUpgradeabilityProxyInstance,
  MarginRequirementsInstance,
  OTCWrapperInstance,
  ForceSendInstance,
  OtokenFactoryInstance,
} from '../../build/types/truffle-types'

import {
  createTokenAmount,
  createScaledBigNumber as scaleBigNum,
  createScaledNumber as scaleNum,
  permit,
  createValidExpiry,
} from '../utils'
const { expectRevert, time, BN, expect } = require('@openzeppelin/test-helpers')
const { parseUnits } = require('ethers/lib/utils')

const { EIP712Domain, domainSeparator } = require('../eip712')
const { fromRpcSig } = require('ethereumjs-util')
const ethSigUtil = require('eth-sig-util')
const Wallet = require('ethereumjs-wallet').default

const MockERC20 = artifacts.require('MockERC20.sol')
const MockOtoken = artifacts.require('MockOtoken.sol')
const MockOracle = artifacts.require('MockOracle.sol')
const OwnedUpgradeabilityProxy = artifacts.require('OwnedUpgradeabilityProxy.sol')
const MarginCalculator = artifacts.require('MarginCalculator.sol')
const MockWhitelistModule = artifacts.require('MockWhitelistModule.sol')
const AddressBook = artifacts.require('AddressBook.sol')
const MarginPool = artifacts.require('MarginPool.sol')
const Controller = artifacts.require('Controller.sol')
const MarginVault = artifacts.require('MarginVault.sol')
const MarginRequirements = artifacts.require('MarginRequirements.sol')
const OTCWrapper = artifacts.require('OTCWrapper.sol')
const ForceSend = artifacts.require('ForceSend.sol')
const OtokenFactory = artifacts.require('OtokenFactory.sol')

// address(0)
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

// permit related
const Permit = [
  { name: 'owner', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
]

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
  InvalidAction,
}

contract('OTCWrapper', ([admin, beneficiary, keeper, random]) => {
  // ERC20 mock
  let usdc: MockERC20Instance
  let weth: MockERC20Instance
  let wbtc: MockERC20Instance
  // oracle module
  let oracle: MockOracleInstance
  // calculator module
  let calculator: MarginCalculatorInstance
  // margin pool module
  let marginPool: MarginPoolInstance
  // whitelist module mock
  let whitelist: MockWhitelistModuleInstance
  // margin requirements module
  let marginRequirements: MarginRequirementsInstance
  // addressbook module mock
  let addressBook: AddressBookInstance
  // otoken factory module
  let otokenFactory: OtokenFactoryInstance
  // otoken implementation module
  let otokenImp: MockOtokenInstance
  // controller module
  let controllerImplementation: ControllerInstance
  let controllerProxy: ControllerInstance
  // OTC Wrapper module
  let otcWrapperImplementation: OTCWrapperInstance
  let otcWrapperProxy: OTCWrapperInstance

  const USDCDECIMALS = 6
  const WETHDECIMALS = 18
  const WBTCDECIMALS = 8

  // permit related
  const name = 'ETHUSDC/1597511955/200P/USDC' // random example name
  const version = '1'
  const user = '0xA94Ab2Bb0C67842FB40A1068068DF1225A031a7d'
  const marketMaker = '0x427fB2c379f02761594768357B33D267fFdf80C5'

  let userSignature1: permit
  let userSignature2: permit
  let mmSignatureWBTC: permit
  let mmSignatureUSDC: permit
  let forceSend: ForceSendInstance

  // time to expiry
  let expiry: number

  before('Deployment', async () => {
    // deploy addressbook
    addressBook = await AddressBook.new()
    // ERC20 deployment
    weth = await MockERC20.new('WETH', 'WETH', WETHDECIMALS)
    usdc = await MockERC20.new('USDC', 'USDC', USDCDECIMALS)
    wbtc = await MockERC20.new('WBTC', 'WBTC', WBTCDECIMALS)

    // deploy oracle
    oracle = await MockOracle.new(addressBook.address, { from: admin })
    // deploy calculator
    calculator = await MarginCalculator.new(oracle.address, addressBook.address)
    // deploy margin pool
    marginPool = await MarginPool.new(addressBook.address)
    // deploy whitelist
    whitelist = await MockWhitelistModule.new()
    // deploy otoken factory
    otokenFactory = await OtokenFactory.new(addressBook.address)
    // deploy otoken
    otokenImp = await MockOtoken.new()
    // set keeper in addressbook
    await addressBook.setKeeper(keeper)
    // set margin pool in addressbook
    await addressBook.setMarginPool(marginPool.address)
    // set calculator in addressbook
    await addressBook.setMarginCalculator(calculator.address)
    // set oracle in addressbook
    await addressBook.setOracle(oracle.address)
    // set whitelist in addressbook
    await addressBook.setWhitelist(whitelist.address)
    // set otoken in addressbook
    await addressBook.setOtokenImpl(otokenImp.address)
    // set otoken factory in addressbook
    await addressBook.setOtokenFactory(otokenFactory.address)
    // deploy MarginRequirements
    marginRequirements = await MarginRequirements.new(addressBook.address)
    // set margin requirements in addressbook
    await addressBook.setMarginRequirements(marginRequirements.address)
    // deploy controller
    const lib = await MarginVault.new()
    await Controller.link('MarginVault', lib.address)
    controllerImplementation = await Controller.new()

    // set controller address in addressbook
    await addressBook.setController(controllerImplementation.address, { from: admin })

    // check controller deployment
    const controllerProxyAddress = await addressBook.getController()
    controllerProxy = await Controller.at(controllerProxyAddress)
    const proxy: OwnedUpgradeabilityProxyInstance = await OwnedUpgradeabilityProxy.at(controllerProxyAddress)

    assert.equal(await proxy.proxyOwner(), addressBook.address, 'Proxy owner address mismatch')
    assert.equal(await controllerProxy.owner(), admin, 'Controller owner address mismatch')
    assert.equal(await controllerProxy.systemPartiallyPaused(), false, 'system is partially paused')

    // deploy OTC wrapper
    otcWrapperImplementation = await OTCWrapper.new()
    const ownedUpgradeabilityProxy: OwnedUpgradeabilityProxyInstance = await OwnedUpgradeabilityProxy.new()
    ownedUpgradeabilityProxy.upgradeTo(otcWrapperImplementation.address)
    otcWrapperProxy = await OTCWrapper.at(ownedUpgradeabilityProxy.address)

    otcWrapperProxy.initialize(addressBook.address, admin, admin, 15 * 60, usdc.address)

    // set OTC wrapper address in addressbook
    await addressBook.setOTCWrapper(otcWrapperProxy.address)

    // set oracle price
    await oracle.setRealTimePrice(usdc.address, scaleBigNum(1, 8))
    await oracle.setRealTimePrice(weth.address, scaleBigNum(1500, 8))
    await oracle.setRealTimePrice(wbtc.address, scaleBigNum(20000, 8))

    // set expiry for options
    expiry = createValidExpiry(Number(await time.latest()), 10)
  })

  describe('permit setup', () => {
    it('set up user permit USDC signature 1', async () => {
      // resulting address = 0xa94ab2bb0c67842fb40a1068068df1225a031a7d
      const randomBuffer = Buffer.alloc(32, 'dsaas')

      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = userWallet.getAddressString()
      const value = parseUnits('5000', 6).toNumber()
      const nonce = 0
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(15 * 60).toString()

      // fund eth
      forceSend = await ForceSend.new(addressBook.address)
      await forceSend.go(owner, { value: ethers.utils.parseEther('2').toString() })

      // fund usdc
      await usdc.mint(owner, createTokenAmount(200000, USDCDECIMALS))

      const buildData = (chainId: number, verifyingContract: string, deadline = maxDeadline) => ({
        primaryType: 'Permit',
        types: { EIP712Domain, Permit },
        domain: { name, version, chainId, verifyingContract },
        message: { owner, spender, value, nonce, deadline },
      })

      const data = buildData((await usdc.getChainId()).toNumber(), usdc.address)
      const signature = ethSigUtil.signTypedMessage(userWallet.getPrivateKey(), { data })
      const { v, r, s } = fromRpcSig(signature)

      const acct = owner
      const amount = value.toString()
      const deadline = maxDeadline

      userSignature1 = { acct, amount, deadline, v, r, s }
    })
    it('set up user permit USDC signature 2', async () => {
      // resulting address = 0xa94ab2bb0c67842fb40a1068068df1225a031a7d
      const randomBuffer = Buffer.alloc(32, 'dsaas')

      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = userWallet.getAddressString()
      const value = parseUnits('5000', 6).toNumber()
      const nonce = 1
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(15 * 60).toString()

      // fund eth
      forceSend = await ForceSend.new(addressBook.address)
      await forceSend.go(owner, { value: ethers.utils.parseEther('2').toString() })

      // fund usdc
      await usdc.mint(owner, createTokenAmount(200000, USDCDECIMALS))

      const buildData = (chainId: number, verifyingContract: string, deadline = maxDeadline) => ({
        primaryType: 'Permit',
        types: { EIP712Domain, Permit },
        domain: { name, version, chainId, verifyingContract },
        message: { owner, spender, value, nonce, deadline },
      })

      const data = buildData((await usdc.getChainId()).toNumber(), usdc.address)
      const signature = ethSigUtil.signTypedMessage(userWallet.getPrivateKey(), { data })
      const { v, r, s } = fromRpcSig(signature)

      const acct = owner
      const amount = value.toString()
      const deadline = maxDeadline

      userSignature2 = { acct, amount, deadline, v, r, s }
    })
    it('set up market maker permit WBTC signature', async () => {
      //resulting address = 0x427fb2c379f02761594768357b33d267ffdf80c5
      const randomBuffer = Buffer.alloc(32, 'abc')

      const mmWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = mmWallet.getAddressString()
      const value = parseUnits('16', 7).toNumber() // 1.6 WBTC
      const nonce = 0
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(200 * 60).toString()

      // fund btc
      await wbtc.mint(owner, createTokenAmount(2, WBTCDECIMALS))

      // fund eth
      forceSend = await ForceSend.new(addressBook.address)
      await forceSend.go(owner, { value: ethers.utils.parseEther('2').toString() })

      const buildData = (chainId: number, verifyingContract: string, deadline = maxDeadline) => ({
        primaryType: 'Permit',
        types: { EIP712Domain, Permit },
        domain: { name, version, chainId, verifyingContract },
        message: { owner, spender, value, nonce, deadline },
      })

      const data = buildData((await wbtc.getChainId()).toNumber(), wbtc.address)
      const signature = ethSigUtil.signTypedMessage(mmWallet.getPrivateKey(), { data })
      const { v, r, s } = fromRpcSig(signature)

      const acct = owner
      const amount = value.toString()
      const deadline = maxDeadline

      mmSignatureWBTC = { acct, amount, deadline, v, r, s }
    })
    it('set up market maker permit USDC signature', async () => {
      //resulting address = 0x427fb2c379f02761594768357b33d267ffdf80c5
      const randomBuffer = Buffer.alloc(32, 'abc')

      const mmWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = mmWallet.getAddressString()
      const value = parseUnits('11501', 6).toNumber()
      const nonce = 0
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(15 * 60).toString()

      // fund eth
      forceSend = await ForceSend.new(addressBook.address)
      await forceSend.go(owner, { value: ethers.utils.parseEther('2').toString() })

      // fund usdc
      await usdc.mint(owner, createTokenAmount(200000, USDCDECIMALS))

      const buildData = (chainId: number, verifyingContract: string, deadline = maxDeadline) => ({
        primaryType: 'Permit',
        types: { EIP712Domain, Permit },
        domain: { name, version, chainId, verifyingContract },
        message: { owner, spender, value, nonce, deadline },
      })

      const data = buildData((await usdc.getChainId()).toNumber(), usdc.address)
      const signature = ethSigUtil.signTypedMessage(mmWallet.getPrivateKey(), { data })
      const { v, r, s } = fromRpcSig(signature)

      const acct = owner
      const amount = value.toString()
      const deadline = maxDeadline

      mmSignatureUSDC = { acct, amount, deadline, v, r, s }
    })
  })

  describe('#initialize', () => {
    it('should revert if initialized with 0 addressBook address', async () => {
      const otcWrapper = await OTCWrapper.new()
      await expectRevert(
        otcWrapper.initialize(ZERO_ADDR, admin, beneficiary, new BigNumber(15 * 60), usdc.address),
        'OTCWrapper: addressbook address cannot be 0',
      )
    })
    it('should revert if initialized with 0 owner address', async () => {
      const otcWrapper = await OTCWrapper.new()
      await expectRevert(
        otcWrapper.initialize(addressBook.address, ZERO_ADDR, beneficiary, new BigNumber(15 * 60), usdc.address),
        'OTCWrapper: owner address cannot be 0',
      )
    })
    it('should revert if initialized with 0 beneficiary address', async () => {
      const otcWrapper = await OTCWrapper.new()
      await expectRevert(
        otcWrapper.initialize(addressBook.address, admin, ZERO_ADDR, new BigNumber(15 * 60), usdc.address),
        'OTCWrapper: beneficiary address cannot be 0',
      )
    })
    it('should revert if initialized with 0 fill deadline', async () => {
      const otcWrapper = await OTCWrapper.new()
      await expectRevert(
        otcWrapper.initialize(addressBook.address, admin, random, new BigNumber(0), usdc.address),
        'OTCWrapper: fill deadline cannot be 0',
      )
    })
    it('should revert if initialized twice', async () => {
      await expectRevert(
        otcWrapperProxy.initialize(addressBook.address, admin, admin, 15 * 60, usdc.address),
        'Contract instance has already been initialized',
      )
    })
    it('successfully initialized', async () => {
      assert.equal(await otcWrapperProxy.owner(), admin)
      assert.equal(await otcWrapperProxy.addressbook(), addressBook.address)
      assert.equal(await otcWrapperProxy.marginRequirements(), marginRequirements.address)
      assert.equal(await otcWrapperProxy.controller(), controllerProxy.address)
      assert.equal(await otcWrapperProxy.oracle(), oracle.address)
      assert.equal(await otcWrapperProxy.beneficiary(), admin)
      assert.equal((await otcWrapperProxy.fillDeadline()).toString(), '900')
      assert.equal(await otcWrapperProxy.USDC(), usdc.address)
    })
  })

  describe('Set min and max notional', () => {
    it('should revert if initialized with 0 asset address', async () => {
      await expectRevert(otcWrapperProxy.setMinMaxNotional(ZERO_ADDR, 1, 1), 'OTCWrapper: asset address cannot be 0')
    })
    it('should revert if initialized with 0 minimum notional', async () => {
      await expectRevert(otcWrapperProxy.setMinMaxNotional(random, 0, 1), 'OTCWrapper: minimum notional cannot be 0')
    })
    it('should revert if initialized with 0 maximum notional', async () => {
      await expectRevert(otcWrapperProxy.setMinMaxNotional(random, 1, 0), 'OTCWrapper: maximum notional cannot be 0')
    })
    it('should revert if caller is not the owner', async () => {
      await expectRevert(
        otcWrapperProxy.setMinMaxNotional(weth.address, 1, 0, { from: random }),
        'Ownable: caller is not the owner.',
      )
    })
    it('sucessfully sets notional size between 50k and 1M USD', async () => {
      otcWrapperProxy.setMinMaxNotional(weth.address, parseUnits('50000', 6), parseUnits('1000000', 6))

      /*       assert.equal(
        (await otcWrapperProxy.minMaxNotional(weth.address))[0].toString(),
        parseUnits('50000', 6).toString(),
      )
      assert.equal(
        (await otcWrapperProxy.minMaxNotional(weth.address))[1].toString(),
        parseUnits('1000000', 6).toString(),
      ) */
    })
  })

  describe('Set whitelist for market makers', () => {
    it('should revert if initialized with 0 market maker address', async () => {
      await expectRevert(
        otcWrapperProxy.setWhitelistMarketMaker(ZERO_ADDR, true),
        'OTCWrapper: market maker address cannot be 0',
      )
    })
    it('should revert if initialized with a repeated whitelist status', async () => {
      await expectRevert(
        otcWrapperProxy.setWhitelistMarketMaker(marketMaker, false),
        'OTCWrapper: whitelist status already in place',
      )
    })
    it('should revert if caller is not the owner', async () => {
      await expectRevert(
        otcWrapperProxy.setWhitelistMarketMaker(marketMaker, true, { from: random }),
        'Ownable: caller is not the owner.',
      )
    })
    it('sucessfully sets market maker whitelist status', async () => {
      assert.equal(await otcWrapperProxy.isWhitelistedMarketMaker(marketMaker), false)

      otcWrapperProxy.setWhitelistMarketMaker(marketMaker, true)

      assert.equal(await otcWrapperProxy.isWhitelistedMarketMaker(marketMaker), true)
    })
  })

  describe('Set fee', () => {
    it('should revert if initialized with 0 asset address', async () => {
      await expectRevert(otcWrapperProxy.setFee(ZERO_ADDR, 1), 'OTCWrapper: asset address cannot be 0')
    })
    it('should revert if initialized with 0 fee', async () => {
      await expectRevert(otcWrapperProxy.setFee(random, 0), 'OTCWrapper: fee cannot be 0')
    })
    it('should revert if caller is not the owner', async () => {
      await expectRevert(otcWrapperProxy.setFee(random, 0, { from: random }), 'Ownable: caller is not the owner.')
    })
    it('sucessfully sets fee to 1% for WETH', async () => {
      await otcWrapperProxy.setFee(weth.address, 100) // 1%

      assert.equal((await otcWrapperProxy.fee(weth.address)).toString(), '100')
    })
    it('sucessfully sets fee to 1% for WBTC', async () => {
      await otcWrapperProxy.setFee(wbtc.address, 100) // 1%

      assert.equal((await otcWrapperProxy.fee(wbtc.address)).toString(), '100')
    })
  })

  describe('Set beneficiary', () => {
    it('should revert if initialized with 0 beneficiary address', async () => {
      await expectRevert(otcWrapperProxy.setBeneficiary(ZERO_ADDR), 'OTCWrapper: beneficiary address cannot be 0')
    })
    it('should revert if caller is not the owner', async () => {
      await expectRevert(otcWrapperProxy.setBeneficiary(random, { from: random }), 'Ownable: caller is not the owner.')
    })
    it('sucessfully sets beneficiary address to admin', async () => {
      assert.equal(await otcWrapperProxy.beneficiary(), admin)

      await otcWrapperProxy.setBeneficiary(beneficiary)

      assert.equal(await otcWrapperProxy.beneficiary(), beneficiary)
    })
  })

  describe('Set fill deadline', () => {
    it('should revert if initialized with 0 fill deadline', async () => {
      await expectRevert(otcWrapperProxy.setFillDeadline(0), 'OTCWrapper: fill deadline cannot be 0')
    })
    it('should revert if caller is not the owner', async () => {
      await expectRevert(otcWrapperProxy.setFillDeadline(600, { from: random }), 'Ownable: caller is not the owner.')
    })
    it('sucessfully sets fill deadline to 10 minutes', async () => {
      assert.equal((await otcWrapperProxy.fillDeadline()).toString(), '900')

      await otcWrapperProxy.setFillDeadline(new BigNumber(600))

      assert.equal((await otcWrapperProxy.fillDeadline()).toString(), '600')
    })
  })

  describe('Place order', () => {
    it('should revert if notional amount is below min', async () => {
      await expectRevert(
        otcWrapperProxy.placeOrder(weth.address, false, 1, expiry, 0, 0),
        'OTCWrapper: invalid notional value',
      )
    })
    it('should revert if notional amount is above max', async () => {
      await expectRevert(
        otcWrapperProxy.placeOrder(weth.address, false, 1, expiry, 0, parseUnits('1', 20)),
        'OTCWrapper: invalid notional value',
      )
    })
    it('should revert if expiry is in the past', async () => {
      const pastExpiry = new BigNumber(await time.latest()).minus(100)

      await expectRevert(
        otcWrapperProxy.placeOrder(weth.address, false, 1, pastExpiry, 0, parseUnits('100000', 6)),
        'OTCWrapper: expiry must be in the future',
      )
    })
    it('sucessfully creates a new order', async () => {
      assert.equal((await otcWrapperProxy.latestOrder()).toString(), '0')

      const strikePrice = scaleBigNum(1300, 8)
      const notional = parseUnits('150000', 6)

      const tx = await otcWrapperProxy.placeOrder(weth.address, false, strikePrice, expiry, 0, notional, {
        from: user,
      })

      assert.equal((await otcWrapperProxy.latestOrder()).toString(), '1')

      // order was placed correctly
      assert.equal((await otcWrapperProxy.orders(1))[0].toString(), weth.address)
      assert.equal((await otcWrapperProxy.orders(1))[1].toString(), ZERO_ADDR)
      assert.equal((await otcWrapperProxy.orders(1))[2].toString(), 'false')
      assert.equal((await otcWrapperProxy.orders(1))[3].toString(), strikePrice.toString())
      assert.equal((await otcWrapperProxy.orders(1))[4].toString(), expiry.toString())
      assert.equal((await otcWrapperProxy.orders(1))[5].toString(), '0')
      assert.equal((await otcWrapperProxy.orders(1))[6].toString(), notional.toString())
      assert.equal((await otcWrapperProxy.orders(1))[7].toString(), user)
      assert.equal((await otcWrapperProxy.orders(1))[8].toString(), ZERO_ADDR)
      assert.equal((await otcWrapperProxy.orders(1))[9].toString(), '0')
      assert.equal((await otcWrapperProxy.orders(1))[10].toString(), ZERO_ADDR)
      assert.equal((await otcWrapperProxy.orders(1))[11].toString(), await time.latest())

      // emits event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), '1')
      assert.equal(logs[0].args.underlyingAsset.toString(), weth.address)
      assert.equal(logs[0].args.isPut.toString(), 'false')
      assert.equal(logs[0].args.strikePrice.toString(), strikePrice.toString())
      assert.equal(logs[0].args.expiry.toString(), expiry.toString())
      assert.equal(logs[0].args.premium.toString(), 0)
      assert.equal(logs[0].args.notional.toString(), notional.toString())
      assert.equal(logs[0].args.buyer.toString(), user)
    })
  })

  describe('Undo order', () => {
    it('should revert if orderID is higher than lastest order', async () => {
      await expectRevert(otcWrapperProxy.undoOrder(3, { from: user }), 'OTCWrapper: inexistent order')
    })
    it('should revert if order buyer is not the caller', async () => {
      await expectRevert(otcWrapperProxy.undoOrder(1, { from: random }), 'OTCWrapper: only buyer can undo the order')
    })
    it('successfully cancels an order', async () => {
      // create a new order
      await otcWrapperProxy.placeOrder(weth.address, true, 1, expiry, 0, parseUnits('150000', 6), {
        from: user,
      })

      assert.equal((await otcWrapperProxy.orderStatus(2)).toString(), '0')

      const tx = await otcWrapperProxy.undoOrder(2, { from: user })

      assert.equal((await otcWrapperProxy.orderStatus(2)).toString(), '2')

      // emits event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), '2')
    })
    it('should revert if order status is not pending', async () => {
      await expectRevert(otcWrapperProxy.undoOrder(2, { from: user }), 'OTCWrapper: can only undo pending orders')
    })
  })

  describe('Execute order', () => {
    it('should revert if orderID is higher than lastest order', async () => {
      await expectRevert(
        otcWrapperProxy.executeOrder(4, userSignature1, mmSignatureUSDC, 1, usdc.address, 1, {
          from: marketMaker,
        }),
        'OTCWrapper: inexistent order',
      )
    })
    it('should revert if order status is not pending', async () => {
      await expectRevert(
        otcWrapperProxy.executeOrder(2, userSignature1, mmSignatureUSDC, 1, usdc.address, 1, {
          from: marketMaker,
        }),
        'OTCWrapper: only pending orders can be executed',
      )
    })
    it('should revert if market maker is not whitelisted', async () => {
      await expectRevert(
        otcWrapperProxy.executeOrder(1, userSignature1, mmSignatureUSDC, 1, usdc.address, 1, {
          from: random,
        }),
        'OTCWrapper: address not whitelisted to execute',
      )
    })
    it('should revert if user permit amount is lower than premium', async () => {
      await expectRevert(
        otcWrapperProxy.executeOrder(1, userSignature1, mmSignatureUSDC, parseUnits('200000', 6), usdc.address, 1, {
          from: marketMaker,
        }),
        'OTCWrapper: insufficient amount',
      )
    })
    it('should revert if the user permit signer is not the order buyer', async () => {
      await otcWrapperProxy.placeOrder(weth.address, true, 1, expiry, 0, parseUnits('150000', 6), {
        from: random,
      })
      await expectRevert(
        otcWrapperProxy.executeOrder(3, userSignature1, mmSignatureUSDC, 1, usdc.address, 1, {
          from: marketMaker,
        }),
        'OTCWrapper: signer is not the buyer',
      )
    })
    it('should revert if the collateral asset is not whitelisted', async () => {
      await expectRevert(
        otcWrapperProxy.executeOrder(
          1,
          userSignature1,
          mmSignatureUSDC,
          parseUnits('5000', 6),
          ZERO_ADDR,
          parseUnits('11501', 6),
          {
            from: marketMaker,
          },
        ),
        'OTCWrapper: collateral is not whitelisted',
      )
    })
    it('should revert if there is not enough collateral to mint', async () => {
      await marginRequirements.setInitialMargin(weth.address, usdc.address, false, marketMaker, 1000)
      await whitelist.whitelistCollateral(usdc.address)

      await expectRevert(
        otcWrapperProxy.executeOrder(
          1,
          userSignature1,
          mmSignatureUSDC,
          parseUnits('5000', 6),
          usdc.address,
          parseUnits('11500', 6),
          {
            from: marketMaker,
          },
        ),
        'OTCWrapper: insufficient collateral',
      )
    })

    it('successfully executes call with collateral in USDC', async () => {
      // admin whitelists product and collateral
      await whitelist.whitelistProduct(weth.address, usdc.address, usdc.address, false)
      await whitelist.whitelistNakedCollateral(usdc.address, weth.address, false)

      // set naked cap collateral to high number
      await controllerProxy.setNakedCap(usdc.address, parseUnits('1', 25))

      // set upper bound values and spot shock
      const upperBoundValue = 1
      await calculator.setUpperBoundValues(weth.address, usdc.address, usdc.address, false, [expiry], [upperBoundValue])
      await calculator.setSpotShock(weth.address, usdc.address, usdc.address, false, scaleBigNum(1500, 35))

      const requiredMargin = new BigNumber(
        await calculator.getNakedMarginRequired(
          weth.address,
          usdc.address,
          usdc.address,
          createTokenAmount(100),
          createTokenAmount(scaleBigNum(1300, 8)),
          scaleBigNum(1500, 8),
          expiry,
          USDCDECIMALS,
          false,
        ),
      )

      // ensure rysk markgin system is a low value
      assert.equal(requiredMargin.toString(), '1')

      const premium = parseUnits('5000', 6)
      const collateralAmount = parseUnits('11501', 6)
      const orderFee = parseUnits('150000', 6).div(100) // fee is set at 1% of notional
      const initialMargin = collateralAmount.add(premium).sub(orderFee)
      const mintAmount = parseUnits('100', 8)

      const userBalBeforeUSDC = new BigNumber(await usdc.balanceOf(user))
      const beneficiaryBalBeforeUSDC = new BigNumber(await usdc.balanceOf(beneficiary))
      const mmBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marketMaker))
      const marginPoolBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))

      // call execute
      const tx = await otcWrapperProxy.executeOrder(
        1,
        userSignature1,
        mmSignatureUSDC,
        premium,
        usdc.address,
        collateralAmount,
        {
          from: marketMaker,
        },
      )

      // set maintenance after opening a vault
      await marginRequirements.setMaintenanceMargin(marketMaker, 1, parseUnits('1000', 6), { from: keeper })

      const newOtoken = await MockERC20.at((await otcWrapperProxy.orders(1))[10].toString())
      const userBalAfterOtoken = new BigNumber(await newOtoken.balanceOf(user))
      const userBalAfterUSDC = new BigNumber(await usdc.balanceOf(user))
      const beneficiaryBalAfterUSDC = new BigNumber(await usdc.balanceOf(beneficiary))
      const mmBalAfterUSDC = new BigNumber(await usdc.balanceOf(marketMaker))
      const marginPoolBalAfterUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))

      // token flows
      assert.equal(userBalBeforeUSDC.minus(userBalAfterUSDC).toString(), premium)
      assert.equal(userBalAfterOtoken.toString(), mintAmount.toString())
      assert.equal(beneficiaryBalAfterUSDC.minus(beneficiaryBalBeforeUSDC).toString(), orderFee.toString())
      assert.equal(mmBalBeforeUSDC.minus(mmBalAfterUSDC).toString(), collateralAmount.toString())
      assert.equal(marginPoolBalAfterUSDC.minus(marginPoolBalBeforeUSDC).toString(), initialMargin.toString())

      // vault data
      const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(otcWrapperProxy.address))
      const vault = await controllerProxy.getVaultWithDetails(otcWrapperProxy.address, vaultCounter)
      assert.equal(new BigNumber(vault[0].shortAmounts[0]).toString(), mintAmount.toString())
      assert.equal(vault[0].shortOtokens[0].toString(), newOtoken.address)
      assert.equal(
        new BigNumber(vault[0].collateralAmounts[0]).toString(),
        collateralAmount.add(premium).sub(orderFee).toString(),
      )
      assert.equal(vault[0].collateralAssets[0].toString(), usdc.address)

      // order accounting
      assert.equal((await otcWrapperProxy.orders(1))[5].toString(), premium.toString())
      assert.equal((await otcWrapperProxy.orders(1))[1].toString(), usdc.address)
      assert.equal((await otcWrapperProxy.orders(1))[8].toString(), marketMaker)
      assert.equal((await otcWrapperProxy.orders(1))[9].toString(), '1')
      assert.equal((await otcWrapperProxy.orderStatus(1)).toString(), '1')

      // emits event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), '1')
      assert.equal(logs[0].args.collateralAsset.toString(), usdc.address)
      assert.equal(logs[0].args.premium.toString(), premium)
      assert.equal(logs[0].args.seller.toString(), marketMaker)
      assert.equal(logs[0].args.vaultID.toString(), '1')
      assert.equal(logs[0].args.oToken.toString(), (await otcWrapperProxy.orders(1))[10].toString())
      assert.equal(logs[0].args.initialMargin.toString(), initialMargin)
    })
    it('successfully executes a put with collateral in WBTC', async () => {
      // set initial margin for new product
      await marginRequirements.setInitialMargin(weth.address, wbtc.address, true, marketMaker, 1000)

      // user places a new order
      const strikePrice = scaleBigNum(1300, 8)
      const notional = parseUnits('300000', 6)

      await otcWrapperProxy.placeOrder(weth.address, true, strikePrice, expiry, 0, notional, {
        from: user,
      })

      assert.equal((await otcWrapperProxy.latestOrder()).toString(), '4')

      // admin whitelists product and collateral
      await whitelist.whitelistProduct(weth.address, usdc.address, wbtc.address, true)
      await whitelist.whitelistNakedCollateral(wbtc.address, weth.address, true)
      await whitelist.whitelistCollateral(wbtc.address)

      // set naked cap collateral to high number
      await controllerProxy.setNakedCap(wbtc.address, parseUnits('1', 25))

      // set upper bound values and spot shock
      const upperBoundValue = 1
      await calculator.setUpperBoundValues(weth.address, usdc.address, wbtc.address, true, [expiry], [upperBoundValue])
      await calculator.setSpotShock(weth.address, usdc.address, wbtc.address, true, scaleBigNum(1500, 35))

      const requiredMargin = new BigNumber(
        await calculator.getNakedMarginRequired(
          weth.address,
          usdc.address,
          wbtc.address,
          createTokenAmount(100),
          createTokenAmount(scaleBigNum(1300, 8)),
          scaleBigNum(1500, 8),
          expiry,
          WBTCDECIMALS,
          true,
        ),
      )

      // ensure rysk markgin system is a low value
      assert.equal(requiredMargin.toString(), '1')

      const premium = parseUnits('5000', 6)
      const collateralAmount = parseUnits('16', 7) // 1.6 WBTC
      const orderFee = notional.div(100) // fee is set at 1% of notional
      const initialMargin = collateralAmount
      const mintAmount = parseUnits('200', 8)

      const userBalBeforeUSDC = new BigNumber(await usdc.balanceOf(user))
      const beneficiaryBalBeforeUSDC = new BigNumber(await usdc.balanceOf(beneficiary))
      const mmBalBeforeWBTC = new BigNumber(await wbtc.balanceOf(marketMaker))
      const marginPoolBalBeforeWBTC = new BigNumber(await wbtc.balanceOf(marginPool.address))
      const mmBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marketMaker))

      // call execute
      const tx = await otcWrapperProxy.executeOrder(
        4,
        userSignature2,
        mmSignatureWBTC,
        premium,
        wbtc.address,
        collateralAmount,
        {
          from: marketMaker,
        },
      )

      // set maintenance after opening a vault
      await marginRequirements.setMaintenanceMargin(marketMaker, 2, parseUnits('1', 7), { from: keeper }) // 0.1 WBTC

      const newOtoken = await MockERC20.at((await otcWrapperProxy.orders(4))[10].toString())
      const userBalAfterOtoken = new BigNumber(await newOtoken.balanceOf(user))
      const userBalAfterUSDC = new BigNumber(await usdc.balanceOf(user))
      const beneficiaryBalAfterUSDC = new BigNumber(await usdc.balanceOf(beneficiary))
      const mmBalAfterWBTC = new BigNumber(await wbtc.balanceOf(marketMaker))
      const marginPoolBalAfterWBTC = new BigNumber(await wbtc.balanceOf(marginPool.address))
      const mmBalAfterUSDC = new BigNumber(await usdc.balanceOf(marketMaker))

      // token flows
      assert.equal(userBalBeforeUSDC.minus(userBalAfterUSDC).toString(), premium)
      assert.equal(userBalAfterOtoken.toString(), mintAmount.toString())
      assert.equal(beneficiaryBalAfterUSDC.minus(beneficiaryBalBeforeUSDC).toString(), orderFee.toString())
      assert.equal(mmBalBeforeWBTC.minus(mmBalAfterWBTC).toString(), collateralAmount.toString())
      assert.equal(marginPoolBalAfterWBTC.minus(marginPoolBalBeforeWBTC).toString(), initialMargin.toString())
      assert.equal(mmBalAfterUSDC.minus(mmBalBeforeUSDC).toString(), premium.sub(orderFee).toString())

      // vault data
      const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(otcWrapperProxy.address))
      const vault = await controllerProxy.getVaultWithDetails(otcWrapperProxy.address, vaultCounter)
      assert.equal(new BigNumber(vault[0].shortAmounts[0]).toString(), mintAmount.toString())
      assert.equal(vault[0].shortOtokens[0].toString(), newOtoken.address)
      assert.equal(new BigNumber(vault[0].collateralAmounts[0]).toString(), collateralAmount)
      assert.equal(vault[0].collateralAssets[0].toString(), wbtc.address)

      // order accounting
      assert.equal((await otcWrapperProxy.orders(4))[5].toString(), premium.toString())
      assert.equal((await otcWrapperProxy.orders(4))[1].toString(), wbtc.address)
      assert.equal((await otcWrapperProxy.orders(4))[8].toString(), marketMaker)
      assert.equal((await otcWrapperProxy.orders(4))[9].toString(), '2')
      assert.equal((await otcWrapperProxy.orderStatus(4)).toString(), '1')

      // emits event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), '4')
      assert.equal(logs[0].args.collateralAsset.toString(), wbtc.address)
      assert.equal(logs[0].args.premium.toString(), premium)
      assert.equal(logs[0].args.seller.toString(), marketMaker)
      assert.equal(logs[0].args.vaultID.toString(), '2')
      assert.equal(logs[0].args.oToken.toString(), (await otcWrapperProxy.orders(4))[10].toString())
      assert.equal(logs[0].args.initialMargin.toString(), initialMargin)
    })
    it('should revert if fill deadline has passed', async () => {
      // place new order
      await otcWrapperProxy.placeOrder(weth.address, false, 1, expiry, 0, parseUnits('150000', 6), {
        from: user,
      })

      // past fill deadline time
      await time.increase(601)

      await expectRevert(
        otcWrapperProxy.executeOrder(5, userSignature1, mmSignatureUSDC, 1, usdc.address, 1, {
          from: marketMaker,
        }),
        'OTCWrapper: deadline has passed',
      )
    })
  })

  describe('Deposit collateral', () => {
    it('should revert if orderID is higher than lastest order', async () => {
      await expectRevert(otcWrapperProxy.depositCollateral(6, 1, { from: marketMaker }), 'OTCWrapper: inexistent order')
    })
    it('should revert if seller is not the caller', async () => {
      await expectRevert(
        otcWrapperProxy.depositCollateral(1, 1, { from: random }),
        'OTCWrapper: sender is not the order seller',
      )
    })
    it('market maker successfully deposits collateral', async () => {
      const depositAmount = parseUnits('2000', 6) // 2000 USDC

      const vaultBefore = await controllerProxy.getVaultWithDetails(otcWrapperProxy.address, 1)

      const vaultCollateralBefore = new BigNumber(vaultBefore[0].collateralAmounts[0])
      const marketMakerBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marketMaker))
      const marginPoolBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))

      // approve
      await usdc.approve(otcWrapperProxy.address, depositAmount, { from: marketMaker })

      // call deposit collateral
      const tx = await otcWrapperProxy.depositCollateral(1, depositAmount, { from: marketMaker })

      const vaultAfter = await controllerProxy.getVaultWithDetails(otcWrapperProxy.address, 1)
      const vaultCollateralAfter = new BigNumber(vaultAfter[0].collateralAmounts[0])
      const marketMakerBalAfterUSDC = new BigNumber(await usdc.balanceOf(marketMaker))
      const marginPoolBalAfterUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))

      // token flows
      assert.equal(vaultCollateralAfter.minus(vaultCollateralBefore).toString(), depositAmount.toString())
      assert.equal(marketMakerBalBeforeUSDC.minus(marketMakerBalAfterUSDC).toString(), depositAmount.toString())
      assert.equal(marginPoolBalAfterUSDC.minus(marginPoolBalBeforeUSDC).toString(), depositAmount.toString())

      // emits event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), '1')
      assert.equal(logs[0].args.amount.toString(), depositAmount)
    })
  })

  describe('Withdraw collateral', () => {
    it('should revert if orderID is higher than lastest order', async () => {
      await expectRevert(
        otcWrapperProxy.withdrawCollateral(6, 1, { from: marketMaker }),
        'OTCWrapper: inexistent order',
      )
    })
    it('should revert if seller is not the caller', async () => {
      await expectRevert(
        otcWrapperProxy.withdrawCollateral(1, 1, { from: random }),
        'OTCWrapper: sender is not the order seller',
      )
    })
    it('should revert if there is insufficient collateral', async () => {
      await expectRevert(
        otcWrapperProxy.withdrawCollateral(1, parseUnits('1001', 6), { from: marketMaker }),
        'OTCWrapper: insufficient collateral',
      )
    })
    it('market maker successfully withdraws collateral', async () => {
      const withdrawAmount = parseUnits('1000', 6) // 1000 USDC

      const vaultBefore = await controllerProxy.getVaultWithDetails(otcWrapperProxy.address, 1)

      const vaultCollateralBefore = new BigNumber(vaultBefore[0].collateralAmounts[0])
      const marketMakerBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marketMaker))
      const marginPoolBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))

      // call withdraw collateral
      const tx = await otcWrapperProxy.withdrawCollateral(1, withdrawAmount, { from: marketMaker })

      const vaultAfter = await controllerProxy.getVaultWithDetails(otcWrapperProxy.address, 1)
      const vaultCollateralAfter = new BigNumber(vaultAfter[0].collateralAmounts[0])
      const marketMakerBalAfterUSDC = new BigNumber(await usdc.balanceOf(marketMaker))
      const marginPoolBalAfterUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))

      // token flows
      assert.equal(vaultCollateralBefore.minus(vaultCollateralAfter).toString(), withdrawAmount.toString())
      assert.equal(marketMakerBalAfterUSDC.minus(marketMakerBalBeforeUSDC).toString(), withdrawAmount.toString())
      assert.equal(marginPoolBalBeforeUSDC.minus(marginPoolBalAfterUSDC).toString(), withdrawAmount.toString())

      // emits event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), '1')
      assert.equal(logs[0].args.amount.toString(), withdrawAmount)
    })
  })

  describe('Settle vault', () => {
    it('should revert if orderID is higher than lastest order', async () => {
      await expectRevert(otcWrapperProxy.settleVault(6, { from: marketMaker }), 'OTCWrapper: inexistent order')
    })
    it('should revert if seller is not the caller', async () => {
      await expectRevert(otcWrapperProxy.settleVault(1, { from: random }), 'OTCWrapper: sender is not the order seller')
    })
    it('should revert if there is not enough collateral after expiry ITM', async () => {
      // past time after expiry
      await time.increase(8600000)

      //set finalized prices
      await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, createTokenAmount(1461), true)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createTokenAmount(1), true)

      // isPut = false
      // Strike price = 1300
      // Expiry price = 1461
      // nr of otokens = 100
      // user payout = (1461-1300)*100 = 16100 USDC
      // collateral in vault = 16001 USDC
      // collateral free to be withdrawn by MM = 16001 - 16100 = -99 USDC

      await expectRevert(otcWrapperProxy.settleVault(1, { from: marketMaker }), 'C32')
    })
    it('market maker successfully settles after expiry ITM and user redeems otokens', async () => {
      // past time after expiry
      await time.increase(8600000)

      //set finalized prices
      await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, createTokenAmount(1400), true)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createTokenAmount(1), true)

      // isPut = false
      // Strike price = 1300
      // Expiry price = 1400
      // nr of otokens = 100
      // user payout = (1400-1300)*100 = 10000 USDC
      // collateral in vault = 16001 USDC
      // collateral free to be withdrawn by MM = 16001 - 10000 = 6001 USDC

      const userPayout = createTokenAmount(10000, USDCDECIMALS)
      const collateralToWithdraw = createTokenAmount(6001, USDCDECIMALS)

      const marginPoolBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))
      const marketMakerBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marketMaker))

      // assert.isAbove((await marginRequirements.maintenanceMargin(marketMaker, 1)).toNumber(), 0)

      // call settle vault
      const tx = await otcWrapperProxy.settleVault(1, { from: marketMaker })

      const marginPoolBalAfterUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))
      const marketMakerBalAfterUSDC = new BigNumber(await usdc.balanceOf(marketMaker))

      // token flows
      assert.equal(marketMakerBalAfterUSDC.minus(marketMakerBalBeforeUSDC).toString(), collateralToWithdraw.toString())
      assert.equal(marginPoolBalBeforeUSDC.minus(marginPoolBalAfterUSDC).toString(), collateralToWithdraw.toString())
      assert.equal(marginPoolBalAfterUSDC.toString(), userPayout.toString())

      // maintenance margin was cleared
      // assert.equal((await marginRequirements.maintenanceMargin(marketMaker, 1)).toString(), '0')

      // emits event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), '1')

      // user redeems the otokens
      const redeemArgs = [
        {
          actionType: ActionType.Redeem,
          owner: ZERO_ADDR,
          secondAddress: user,
          asset: (await otcWrapperProxy.orders(1))[10].toString(),
          vaultId: '1',
          amount: createTokenAmount(100),
          index: '0',
          data: ZERO_ADDR,
        },
      ]

      const userBalAfterUSDC = new BigNumber(await usdc.balanceOf(user))
      await controllerProxy.operate(redeemArgs, { from: user })
      const userBalanceAfter = new BigNumber(await usdc.balanceOf(user))

      assert.equal(userBalanceAfter.minus(userBalAfterUSDC).toString(), userPayout.toString())
    })
    it('market maker successfully settles after expiry OTM', async () => {
      // past time after expiry
      await time.increase(8600000)

      // set finalized prices
      await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, createTokenAmount(1301), true)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(wbtc.address, expiry, createTokenAmount(20000), true)

      // isPut = true
      // Strike price = 1300
      // Expiry price = 1301
      // nr of otokens = 100
      // user payout = 0 | OTM
      // collateral in vault = 1.6 WBTC
      // collateral free to be withdrawn by MM = 1.6 - 0 = 1.6 WBTC

      const collateralToWithdraw = createTokenAmount(16, 7)

      const marginPoolBalBeforeWBTC = new BigNumber(await wbtc.balanceOf(marginPool.address))
      const marketMakerBalBeforeWBTC = new BigNumber(await wbtc.balanceOf(marketMaker))

      // assert.isAbove((await marginRequirements.maintenanceMargin(marketMaker, 2)).toNumber(), 0)

      // call settle vault
      const tx = await otcWrapperProxy.settleVault(4, { from: marketMaker })

      const marginPoolBalAfterWBTC = new BigNumber(await wbtc.balanceOf(marginPool.address))
      const marketMakerBalAfterWBTC = new BigNumber(await wbtc.balanceOf(marketMaker))

      // token flows
      assert.equal(marketMakerBalAfterWBTC.minus(marketMakerBalBeforeWBTC).toString(), collateralToWithdraw.toString())
      assert.equal(marginPoolBalBeforeWBTC.minus(marginPoolBalAfterWBTC).toString(), collateralToWithdraw.toString())
      assert.equal(marginPoolBalAfterWBTC.toString(), '0')

      // maintenance margin was cleared
      // assert.equal((await marginRequirements.maintenanceMargin(marketMaker, 1)).toString(), '0')

      // emits event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), '4')
    })
  })
})

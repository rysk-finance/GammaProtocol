import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'

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
  MinimalForwarderInstance,
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
const MinimalForwarder = artifacts.require('MinimalForwarder.sol')

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

// minimal forwarder related
const EIP712Domain = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
]

const ForwardRequest = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'gas', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'data', type: 'bytes' },
]

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
  // minimal forwarder
  let minimalForwarder: MinimalForwarderInstance
  let untrustedMinimalForwarder: MinimalForwarderInstance
  let newMinimalForwarder: MinimalForwarderInstance

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
  let userSignature3: permit
  let userSignature4: permit
  let userSignature5: permit
  let userSignature6: permit
  let userSignature7: permit
  let mmSignatureEmpty: permit
  let mmSignatureUSDC1: permit
  let mmSignatureUSDC2: permit
  let mmSignatureUSDC3: permit
  let mmSignatureUSDC4: permit
  let mmSignatureUSDC5: permit
  let mmSignatureUSDC6: permit
  let forceSend: ForceSendInstance

  // time to expiry
  let expiry: number

  // minimal forwarder
  let signatureData: {
    primaryType: string
    types: { EIP712Domain: { name: string; type: string }[]; ForwardRequest: { name: string; type: string }[] }
    domain: { name: string; version: string; chainId: number; verifyingContract: string }
    message: { from: string; to: string; value: number; gas: any; nonce: number; data: string }
  }
  let signatureData2: {
    primaryType: string
    types: { EIP712Domain: { name: string; type: string }[]; ForwardRequest: { name: string; type: string }[] }
    domain: { name: string; version: string; chainId: number; verifyingContract: string }
    message: { from: string; to: string; value: number; gas: any; nonce: number; data: string }
  }
  let signatureData3: {
    primaryType: string
    types: { EIP712Domain: { name: string; type: string }[]; ForwardRequest: { name: string; type: string }[] }
    domain: { name: string; version: string; chainId: number; verifyingContract: string }
    message: { from: string; to: string; value: number; gas: any; nonce: number; data: string }
  }
  let signatureData4: {
    primaryType: string
    types: { EIP712Domain: { name: string; type: string }[]; ForwardRequest: { name: string; type: string }[] }
    domain: { name: string; version: string; chainId: number; verifyingContract: string }
    message: { from: string; to: string; value: number; gas: any; nonce: number; data: string }
  }
  let signatureData5: {
    primaryType: string
    types: { EIP712Domain: { name: string; type: string }[]; ForwardRequest: { name: string; type: string }[] }
    domain: { name: string; version: string; chainId: number; verifyingContract: string }
    message: { from: string; to: string; value: number; gas: any; nonce: number; data: string }
  }
  let signatureData6: {
    primaryType: string
    types: { EIP712Domain: { name: string; type: string }[]; ForwardRequest: { name: string; type: string }[] }
    domain: { name: string; version: string; chainId: number; verifyingContract: string }
    message: { from: string; to: string; value: number; gas: any; nonce: number; data: string }
  }
  let signatureData7: {
    primaryType: string
    types: { EIP712Domain: { name: string; type: string }[]; ForwardRequest: { name: string; type: string }[] }
    domain: { name: string; version: string; chainId: number; verifyingContract: string }
    message: { from: string; to: string; value: number; gas: any; nonce: number; data: string }
  }

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

    // deploy minimal forwarder
    minimalForwarder = await MinimalForwarder.new()
    untrustedMinimalForwarder = await MinimalForwarder.new()

    // deploy OTC wrapper
    otcWrapperImplementation = await OTCWrapper.new(minimalForwarder.address, usdc.address)
    const ownedUpgradeabilityProxy: OwnedUpgradeabilityProxyInstance = await OwnedUpgradeabilityProxy.new()
    ownedUpgradeabilityProxy.upgradeTo(otcWrapperImplementation.address)
    otcWrapperProxy = await OTCWrapper.at(ownedUpgradeabilityProxy.address)

    otcWrapperProxy.initialize(addressBook.address, admin, 15 * 60)

    // set OTC wrapper address in addressbook
    await addressBook.setOTCWrapper(otcWrapperProxy.address)

    // set oracle price
    await oracle.setRealTimePrice(usdc.address, scaleBigNum(1, 8))
    await oracle.setRealTimePrice(weth.address, scaleBigNum(1500, 8))
    await oracle.setRealTimePrice(wbtc.address, scaleBigNum(20000, 8))

    // set expiry for options
    expiry = createValidExpiry(Number(await time.latest()), 10)

    // admin whitelists product and collateral
    await whitelist.whitelistCollateral(usdc.address)
    await whitelist.whitelistProduct(weth.address, usdc.address, usdc.address, false)
    await whitelist.whitelistNakedCollateral(usdc.address, weth.address, false)

    await whitelist.whitelistProduct(weth.address, usdc.address, wbtc.address, true)
    await whitelist.whitelistNakedCollateral(wbtc.address, weth.address, true)
    await whitelist.whitelistCollateral(wbtc.address)

    // set initial margin for new product
    await marginRequirements.setInitialMargin(weth.address, wbtc.address, true, marketMaker, 1000)
    await marginRequirements.setInitialMargin(weth.address, usdc.address, false, marketMaker, 1000)

    // set naked cap collateral to high number
    await controllerProxy.setNakedCap(usdc.address, parseUnits('1', 25))
    await controllerProxy.setNakedCap(wbtc.address, parseUnits('1', 25))

    // set upper bound values and spot shock
    const upperBoundValue = 1
    await calculator.setUpperBoundValues(weth.address, usdc.address, usdc.address, false, [expiry], [upperBoundValue])
    await calculator.setSpotShock(weth.address, usdc.address, usdc.address, false, scaleBigNum(1500, 35))

    await calculator.setUpperBoundValues(weth.address, usdc.address, wbtc.address, true, [expiry], [upperBoundValue])
    await calculator.setSpotShock(weth.address, usdc.address, wbtc.address, true, scaleBigNum(1500, 35))

    // USDC at expiry
    await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createTokenAmount(1), true)
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
      const maxDeadline = new BigNumber(await time.latest()).plus(8600000 * 50).toString()

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

      userSignature1 = { amount, deadline, acct, v, r, s }
    })
    it('set up user permit USDC signature 2', async () => {
      // resulting address = 0xa94ab2bb0c67842fb40a1068068df1225a031a7d
      const randomBuffer = Buffer.alloc(32, 'dsaas')

      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = userWallet.getAddressString()
      const value = parseUnits('5000', 6).toNumber()
      const nonce = 1
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(8600000 * 50).toString()

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

      userSignature2 = { amount, deadline, acct, v, r, s }
    })
    it('set up user permit USDC signature 3', async () => {
      // resulting address = 0xa94ab2bb0c67842fb40a1068068df1225a031a7d
      const randomBuffer = Buffer.alloc(32, 'dsaas')

      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = userWallet.getAddressString()
      const value = parseUnits('5000', 6).toNumber()
      const nonce = 2
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(8600000 * 100).toString()

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

      userSignature3 = { amount, deadline, acct, v, r, s }
    })
    it('set up user permit USDC signature 4', async () => {
      // resulting address = 0xa94ab2bb0c67842fb40a1068068df1225a031a7d
      const randomBuffer = Buffer.alloc(32, 'dsaas')

      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = userWallet.getAddressString()
      const value = parseUnits('10000', 6).toNumber()
      const nonce = 3
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(8600000 * 50).toString()

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

      userSignature4 = { amount, deadline, acct, v, r, s }
    })
    it('set up user permit USDC signature 5', async () => {
      // resulting address = 0xa94ab2bb0c67842fb40a1068068df1225a031a7d
      const randomBuffer = Buffer.alloc(32, 'dsaas')

      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = userWallet.getAddressString()
      const value = parseUnits('5000', 6).toNumber()
      const nonce = 3
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(8600000 * 100).toString()

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

      userSignature5 = { amount, deadline, acct, v, r, s }
    })
    it('set up user permit USDC signature 6', async () => {
      // resulting address = 0xa94ab2bb0c67842fb40a1068068df1225a031a7d
      const randomBuffer = Buffer.alloc(32, 'dsaas')

      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = userWallet.getAddressString()
      const value = parseUnits('5000', 6).toNumber()
      const nonce = 4
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(8600000 * 100).toString()

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

      userSignature6 = { amount, deadline, acct, v, r, s }
    })
    it('set up user permit USDC signature 7', async () => {
      // resulting address = 0xa94ab2bb0c67842fb40a1068068df1225a031a7d
      const randomBuffer = Buffer.alloc(32, 'dsaas')

      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = userWallet.getAddressString()
      const value = parseUnits('5000', 6).toNumber()
      const nonce = 5
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(8600000 * 100).toString()

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

      userSignature7 = { amount, deadline, acct, v, r, s }
    })
    it('set up market maker permit empty signature', async () => {
      //resulting address = 0x427fb2c379f02761594768357b33d267ffdf80c5
      const randomBuffer = Buffer.alloc(32, 'abc')

      const mmWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = mmWallet.getAddressString()
      const value = 0
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

      mmSignatureEmpty = { amount, deadline, acct, v, r, s }
    })
    it('set up market maker permit USDC signature 1', async () => {
      //resulting address = 0x427fb2c379f02761594768357b33d267ffdf80c5
      const randomBuffer = Buffer.alloc(32, 'abc')

      const mmWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = mmWallet.getAddressString()
      const value = parseUnits('15001', 6).toNumber()
      const nonce = 0
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(8600000 * 50).toString()

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

      mmSignatureUSDC1 = { amount, deadline, acct, v, r, s }
    })
    it('set up market maker permit USDC signature 2', async () => {
      //resulting address = 0x427fb2c379f02761594768357b33d267ffdf80c5
      const randomBuffer = Buffer.alloc(32, 'abc')

      const mmWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = mmWallet.getAddressString()
      const value = parseUnits('15001', 6).toNumber()
      const nonce = 1
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(8600000 * 50).toString()

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

      mmSignatureUSDC2 = { amount, deadline, acct, v, r, s }
    })
    it('set up market maker permit USDC signature 3', async () => {
      //resulting address = 0x427fb2c379f02761594768357b33d267ffdf80c5
      const randomBuffer = Buffer.alloc(32, 'abc')

      const mmWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = mmWallet.getAddressString()
      const value = parseUnits('2000', 6).toNumber()
      const nonce = 2
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(8600000 * 50).toString()

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

      mmSignatureUSDC3 = { amount, deadline, acct, v, r, s }
    })
    it('set up market maker permit USDC signature 4', async () => {
      //resulting address = 0x427fb2c379f02761594768357b33d267ffdf80c5
      const randomBuffer = Buffer.alloc(32, 'abc')

      const mmWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = mmWallet.getAddressString()
      const value = parseUnits('15001', 6).toNumber()
      const nonce = 3
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(8600000 * 100).toString()

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

      mmSignatureUSDC4 = { amount, deadline, acct, v, r, s }
    })
    it('set up market maker permit USDC signature 5', async () => {
      //resulting address = 0x427fb2c379f02761594768357b33d267ffdf80c5
      const randomBuffer = Buffer.alloc(32, 'abc')

      const mmWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = mmWallet.getAddressString()
      const value = parseUnits('15001', 6).toNumber()
      const nonce = 4
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(8600000 * 100).toString()

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

      mmSignatureUSDC5 = { amount, deadline, acct, v, r, s }
    })
    it('set up market maker permit USDC signature 6', async () => {
      //resulting address = 0x427fb2c379f02761594768357b33d267ffdf80c5
      const randomBuffer = Buffer.alloc(32, 'abc')

      const mmWallet = Wallet.fromPrivateKey(randomBuffer)

      const owner = mmWallet.getAddressString()
      const value = parseUnits('15001', 6).toNumber()
      const nonce = 5
      const spender = otcWrapperProxy.address
      const maxDeadline = new BigNumber(await time.latest()).plus(8600000 * 100).toString()

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

      mmSignatureUSDC6 = { amount, deadline, acct, v, r, s }
    })
    it('set up user signature for placing a new order via trusted minimal forwarder', async () => {
      const chainId = (await usdc.getChainId()).toNumber() // 8545

      const strikePrice2 = scaleBigNum(1700, 8).toNumber()
      const size2 = parseUnits('110', 8).toNumber()

      const dataExample = [weth.address, false, strikePrice2, expiry, 1, size2]

      let ABI = [
        'function placeOrder(address _underlying, bool _isPut, uint256 _strikePrice, uint256 _expiry, uint256 _premium, uint256 _size)',
      ]
      let iface = new ethers.utils.Interface(ABI)

      const callData = iface.encodeFunctionData('placeOrder', dataExample)

      const name = 'MinimalForwarder'
      const verifyingContract = minimalForwarder.address
      const version = '0.0.1'

      const from = user
      const to = otcWrapperProxy.address
      const value = 0
      const gas = 3000000
      const nonce = 0
      const data = callData

      const buildData = () => ({
        primaryType: 'ForwardRequest',
        types: { EIP712Domain, ForwardRequest },
        domain: { name, version, chainId, verifyingContract },
        message: { from, to, value, gas, nonce, data },
      })

      signatureData = buildData()
    })
    it('set up user signature for placing a new order via untrusted minimal forwarder', async () => {
      const chainId = (await usdc.getChainId()).toNumber() // 8545

      const strikePrice2 = scaleBigNum(1700, 8).toNumber()
      const size2 = parseUnits('110', 8).toNumber()

      const dataExample = [weth.address, false, strikePrice2, expiry, 1, size2]

      let ABI = [
        'function placeOrder(address _underlying, bool _isPut, uint256 _strikePrice, uint256 _expiry, uint256 _premium, uint256 _size)',
      ]
      let iface = new ethers.utils.Interface(ABI)

      const callData = iface.encodeFunctionData('placeOrder', dataExample)

      const name = 'MinimalForwarder'
      const verifyingContract = untrustedMinimalForwarder.address
      const version = '0.0.1'

      const from = user
      const to = otcWrapperProxy.address
      const value = 0
      const gas = 3000000
      const nonce = 0
      const data = callData

      const buildData = () => ({
        primaryType: 'ForwardRequest',
        types: { EIP712Domain, ForwardRequest },
        domain: { name, version, chainId, verifyingContract },
        message: { from, to, value, gas, nonce, data },
      })

      signatureData2 = buildData()
    })
    it('set up user signature for undo a new order via trusted minimal forwarder', async () => {
      const chainId = (await usdc.getChainId()).toNumber() // 8545

      const orderId = 5

      const dataExample = [orderId]

      let ABI = ['function undoOrder(uint256 _orderID)']
      let iface = new ethers.utils.Interface(ABI)

      const callData = iface.encodeFunctionData('undoOrder', dataExample)

      const name = 'MinimalForwarder'
      const verifyingContract = minimalForwarder.address
      const version = '0.0.1'

      const from = user
      const to = otcWrapperProxy.address
      const value = 0
      const gas = 3000000
      const nonce = 1
      const data = callData

      const buildData = () => ({
        primaryType: 'ForwardRequest',
        types: { EIP712Domain, ForwardRequest },
        domain: { name, version, chainId, verifyingContract },
        message: { from, to, value, gas, nonce, data },
      })

      signatureData3 = buildData()
    })
    it('set up market maker signature for deposit collateral via trusted minimal forwarder', async () => {
      const chainId = (await usdc.getChainId()).toNumber() // 8545

      const orderId = 7
      const depositAmount = 100000000 // 1 WBTC

      const dataExample = [orderId, depositAmount, mmSignatureEmpty]

      let ABI = depositCollateralABI
      let iface = new ethers.utils.Interface(ABI)

      const callData = iface.encodeFunctionData('depositCollateral', dataExample)

      const name = 'MinimalForwarder'
      const verifyingContract = minimalForwarder.address
      const version = '0.0.1'

      const from = marketMaker
      const to = otcWrapperProxy.address
      const value = 0
      const gas = 3000000
      const nonce = 1
      const data = callData

      const buildData = () => ({
        primaryType: 'ForwardRequest',
        types: { EIP712Domain, ForwardRequest },
        domain: { name, version, chainId, verifyingContract },
        message: { from, to, value, gas, nonce, data },
      })

      signatureData4 = buildData()
    })
    it('set up market maker signature for withdraw collateral via trusted minimal forwarder', async () => {
      const chainId = (await usdc.getChainId()).toNumber() // 8545

      const orderId = 7
      const withdrawAmount = 100000000 // 1 WBTC

      const dataExample = [orderId, withdrawAmount]

      let ABI = ['function withdrawCollateral(uint256 _orderID, uint256 _amount)']
      let iface = new ethers.utils.Interface(ABI)

      const callData = iface.encodeFunctionData('withdrawCollateral', dataExample)

      const name = 'MinimalForwarder'
      const verifyingContract = minimalForwarder.address
      const version = '0.0.1'

      const from = marketMaker
      const to = otcWrapperProxy.address
      const value = 0
      const gas = 3000000
      const nonce = 2
      const data = callData

      const buildData = () => ({
        primaryType: 'ForwardRequest',
        types: { EIP712Domain, ForwardRequest },
        domain: { name, version, chainId, verifyingContract },
        message: { from, to, value, gas, nonce, data },
      })

      signatureData5 = buildData()
    })
    it('set up market maker signature for execute trade via trusted minimal forwarder', async () => {
      const chainId = (await usdc.getChainId()).toNumber() // 8545

      const orderId = 8
      const premium = parseUnits('5000', 6)
      const collateralAmount = parseUnits('15001', 6)

      const dataExample = [orderId, userSignature3, mmSignatureUSDC2, premium, usdc.address, collateralAmount]

      let iface = new ethers.utils.Interface(executeOrderABI)

      const callData = iface.encodeFunctionData('executeOrder', dataExample)

      const name = 'MinimalForwarder'
      const verifyingContract = minimalForwarder.address
      const version = '0.0.1'

      const from = marketMaker
      const to = otcWrapperProxy.address
      const value = 0
      const gas = 3000000
      const nonce = 0
      const data = callData

      const buildData = () => ({
        primaryType: 'ForwardRequest',
        types: { EIP712Domain, ForwardRequest },
        domain: { name, version, chainId, verifyingContract },
        message: { from, to, value, gas, nonce, data },
      })

      signatureData6 = buildData()
    })
    it('set up market maker signature for settle vault via trusted minimal forwarder', async () => {
      const chainId = (await usdc.getChainId()).toNumber() // 8545

      const orderId = 8

      const dataExample = [orderId]

      let ABI = ['function settleVault(uint256 _orderID)']
      let iface = new ethers.utils.Interface(ABI)

      const callData = iface.encodeFunctionData('settleVault', dataExample)

      const name = 'MinimalForwarder'
      const verifyingContract = minimalForwarder.address
      const version = '0.0.1'

      const from = marketMaker
      const to = otcWrapperProxy.address
      const value = 0
      const gas = 3000000
      const nonce = 3
      const data = callData

      const buildData = () => ({
        primaryType: 'ForwardRequest',
        types: { EIP712Domain, ForwardRequest },
        domain: { name, version, chainId, verifyingContract },
        message: { from, to, value, gas, nonce, data },
      })

      signatureData7 = buildData()
    })
  })

  describe('#initialize', () => {
    it('should revert if initialized with 0 USDC address', async () => {
      await expectRevert(OTCWrapper.new(minimalForwarder.address, ZERO_ADDR), 'OTCWrapper: usdc address cannot be 0')
    })
    it('should revert if initialized with 0 addressBook address', async () => {
      const otcWrapper = await OTCWrapper.new(minimalForwarder.address, usdc.address)
      await expectRevert(
        otcWrapper.initialize(ZERO_ADDR, beneficiary, new BigNumber(15 * 60)),
        'OTCWrapper: addressbook address cannot be 0',
      )
    })
    it('should revert if initialized with 0 beneficiary address', async () => {
      const otcWrapper = await OTCWrapper.new(minimalForwarder.address, usdc.address)
      await expectRevert(
        otcWrapper.initialize(addressBook.address, ZERO_ADDR, new BigNumber(15 * 60)),
        'OTCWrapper: beneficiary address cannot be 0',
      )
    })
    it('should revert if initialized with 0 fill deadline', async () => {
      const otcWrapper = await OTCWrapper.new(minimalForwarder.address, usdc.address)
      await expectRevert(
        otcWrapper.initialize(addressBook.address, random, new BigNumber(0)),
        'OTCWrapper: fill deadline cannot be 0',
      )
    })
    it('should revert if initialized twice', async () => {
      await expectRevert(
        otcWrapperProxy.initialize(addressBook.address, admin, 15 * 60),
        'Initializable: contract is already initialized',
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
        'Ownable: caller is not the owner',
      )
    })
    it('sucessfully sets notional size between 50k and 1M USD', async () => {
      await otcWrapperProxy.setMinMaxNotional(weth.address, parseUnits('50000', 6), parseUnits('1000000', 6))

      assert.equal(
        (await otcWrapperProxy.minMaxNotional(weth.address))[0].toString(),
        parseUnits('50000', 6).toString(),
      )
      assert.equal(
        (await otcWrapperProxy.minMaxNotional(weth.address))[1].toString(),
        parseUnits('1000000', 6).toString(),
      )
    })
  })

  describe('Set whitelist for market makers', () => {
    it('should revert if initialized with 0 market maker address', async () => {
      await expectRevert(
        otcWrapperProxy.setWhitelistMarketMaker(ZERO_ADDR, true),
        'OTCWrapper: market maker address cannot be 0',
      )
    })
    it('should revert if caller is not the owner', async () => {
      await expectRevert(
        otcWrapperProxy.setWhitelistMarketMaker(marketMaker, true, { from: random }),
        'Ownable: caller is not the owner',
      )
    })
    it('sucessfully sets market maker whitelist status', async () => {
      assert.equal(await otcWrapperProxy.isWhitelistedMarketMaker(marketMaker), false)

      await otcWrapperProxy.setWhitelistMarketMaker(marketMaker, true)

      assert.equal(await otcWrapperProxy.isWhitelistedMarketMaker(marketMaker), true)
    })
  })

  describe('Set fee', () => {
    it('should revert if initialized with 0 asset address', async () => {
      await expectRevert(otcWrapperProxy.setFee(ZERO_ADDR, 1), 'OTCWrapper: asset address cannot be 0')
    })
    it('should revert if caller is not the owner', async () => {
      await expectRevert(otcWrapperProxy.setFee(random, 0, { from: random }), 'Ownable: caller is not the owner')
    })
    it('should revert if initialized with fee over 100%', async () => {
      await expectRevert(
        otcWrapperProxy.setFee(random, parseUnits('1', 7)),
        'OTCWrapper: fee cannot be higher than 100%',
      )
    })
    it('sucessfully sets fee to 1% for WETH', async () => {
      await otcWrapperProxy.setFee(weth.address, 10000) // 1%

      assert.equal((await otcWrapperProxy.fee(weth.address)).toString(), '10000')
    })
    it('sucessfully sets fee to 1% for WBTC', async () => {
      await otcWrapperProxy.setFee(wbtc.address, 10000) // 1%

      assert.equal((await otcWrapperProxy.fee(wbtc.address)).toString(), '10000')
    })
  })

  describe('Set beneficiary', () => {
    it('should revert if initialized with 0 beneficiary address', async () => {
      await expectRevert(otcWrapperProxy.setBeneficiary(ZERO_ADDR), 'OTCWrapper: beneficiary address cannot be 0')
    })
    it('should revert if caller is not the owner', async () => {
      await expectRevert(otcWrapperProxy.setBeneficiary(random, { from: random }), 'Ownable: caller is not the owner')
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
      await expectRevert(otcWrapperProxy.setFillDeadline(600, { from: random }), 'Ownable: caller is not the owner')
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
        'OTCWrapper: size cannot be 0',
      )
    })
    it('should revert if notional amount is below min', async () => {
      await expectRevert(
        otcWrapperProxy.placeOrder(weth.address, false, 1, expiry, 0, 1),
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
        otcWrapperProxy.placeOrder(weth.address, false, 1, pastExpiry, 0, parseUnits('100', 8)),
        'OTCWrapper: expiry must be in the future',
      )
    })
    it('user sucessfully creates a new order via direct call', async () => {
      assert.equal((await otcWrapperProxy.latestOrder()).toString(), '0')

      const strikePrice = scaleBigNum(1300, 8)
      // notional = parseUnits('150000', 6)
      const size = parseUnits('100', 8)

      const tx = await otcWrapperProxy.placeOrder(
        weth.address,
        false,
        strikePrice,
        expiry,
        parseUnits('5000', 6),
        size,
        {
          from: user,
        },
      )

      assert.equal((await otcWrapperProxy.latestOrder()).toString(), '1')

      assert.equal((await otcWrapperProxy.ordersByAcct(user, 0)).toString(), '1')

      // order was placed correctly
      assert.equal((await otcWrapperProxy.orders(1))[0].toString(), weth.address)
      assert.equal((await otcWrapperProxy.orders(1))[1].toString(), ZERO_ADDR)
      assert.equal((await otcWrapperProxy.orders(1))[2].toString(), 'false')
      assert.equal((await otcWrapperProxy.orders(1))[3].toString(), strikePrice.toString())
      assert.equal((await otcWrapperProxy.orders(1))[4].toString(), expiry.toString())
      assert.equal((await otcWrapperProxy.orders(1))[5].toString(), parseUnits('5000', 6).toString())
      assert.equal((await otcWrapperProxy.orders(1))[6].toString(), '0')
      assert.equal((await otcWrapperProxy.orders(1))[7].toString(), user)
      assert.equal((await otcWrapperProxy.orders(1))[8].toString(), ZERO_ADDR)
      assert.equal((await otcWrapperProxy.orders(1))[9].toString(), '0')
      assert.equal((await otcWrapperProxy.orders(1))[10].toString(), ZERO_ADDR)
      assert.equal((await otcWrapperProxy.orders(1))[11].toString(), await time.latest())
      assert.equal((await otcWrapperProxy.orders(1))[12].toString(), size.toString())

      // emits event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), '1')
      assert.equal(logs[0].args.underlyingAsset.toString(), weth.address)
      assert.equal(logs[0].args.isPut.toString(), 'false')
      assert.equal(logs[0].args.strikePrice.toString(), strikePrice.toString())
      assert.equal(logs[0].args.expiry.toString(), expiry.toString())
      assert.equal(logs[0].args.premium.toString(), parseUnits('5000', 6).toString())
      assert.equal(logs[0].args.size.toString(), size.toString())
      assert.equal(logs[0].args.buyer.toString(), user)
    })
    it('user sucessfully creates a new order via minimal forwarder', async () => {
      const strikePrice2 = scaleBigNum(1700, 8).toNumber()
      const size2 = parseUnits('110', 8).toNumber()

      const randomBuffer = Buffer.alloc(32, 'dsaas')
      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      const dataExample = [weth.address, false, strikePrice2, expiry, 1, size2]

      let ABI = [
        'function placeOrder(address _underlying, bool _isPut, uint256 _strikePrice, uint256 _expiry, uint256 _premium, uint256 _size)',
      ]
      let iface = new ethers.utils.Interface(ABI)
      const callData = iface.encodeFunctionData('placeOrder', dataExample)

      const forwardRequest = {
        from: user,
        to: otcWrapperProxy.address,
        value: 0,
        gas: 3000000,
        nonce: 0,
        data: callData,
      }

      const data = signatureData
      const signature = ethSigUtil.signTypedMessage(userWallet.getPrivateKey(), { data })

      assert.equal((await otcWrapperProxy.latestOrder()).toString(), '1')
      assert.equal((await otcWrapperProxy.ordersByAcct(user, 0)).toString(), '1')

      await minimalForwarder.execute(forwardRequest, signature, { from: user })

      assert.equal((await otcWrapperProxy.latestOrder()).toString(), '2')
      assert.equal((await otcWrapperProxy.ordersByAcct(user, 1)).toString(), '2')

      // order was placed correctly
      assert.equal((await otcWrapperProxy.orders(2))[0].toString(), weth.address)
      assert.equal((await otcWrapperProxy.orders(2))[1].toString(), ZERO_ADDR)
      assert.equal((await otcWrapperProxy.orders(2))[2].toString(), 'false')
      assert.equal((await otcWrapperProxy.orders(2))[3].toString(), strikePrice2.toString())
      assert.equal((await otcWrapperProxy.orders(2))[4].toString(), expiry.toString())
      assert.equal((await otcWrapperProxy.orders(2))[5].toString(), '1')
      assert.equal((await otcWrapperProxy.orders(2))[6].toString(), '0')
      assert.equal((await otcWrapperProxy.orders(2))[7].toString(), user)
      assert.equal((await otcWrapperProxy.orders(2))[8].toString(), ZERO_ADDR)
      assert.equal((await otcWrapperProxy.orders(2))[9].toString(), '0')
      assert.equal((await otcWrapperProxy.orders(2))[10].toString(), ZERO_ADDR)
      assert.equal((await otcWrapperProxy.orders(2))[11].toString(), await time.latest())
      assert.equal((await otcWrapperProxy.orders(2))[12].toString(), size2.toString())
    })
    it('should not pass along the user as msg.sender if order is placed via an untrusted minimal forwarder', async () => {
      const strikePrice2 = scaleBigNum(1700, 8).toNumber()
      const size2 = parseUnits('110', 8).toNumber()

      const randomBuffer = Buffer.alloc(32, 'dsaas')
      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      const dataExample = [weth.address, false, strikePrice2, expiry, 1, size2]

      let ABI = [
        'function placeOrder(address _underlying, bool _isPut, uint256 _strikePrice, uint256 _expiry, uint256 _premium, uint256 _size)',
      ]
      let iface = new ethers.utils.Interface(ABI)
      const callData = iface.encodeFunctionData('placeOrder', dataExample)

      const data = signatureData2
      const signature = ethSigUtil.signTypedMessage(userWallet.getPrivateKey(), { data })

      const forwardRequest = {
        from: user,
        to: otcWrapperProxy.address,
        value: 0,
        gas: 3000000,
        nonce: 0,
        data: callData,
      }

      await untrustedMinimalForwarder.execute(forwardRequest, signature, { from: user })

      // ensure that msg.sender that was passed along as order.buyer is the untrusted minimal forwarder and not the user
      assert.equal((await otcWrapperProxy.orders(3))[7].toString(), untrustedMinimalForwarder.address)
    })
  })

  describe('Undo order', () => {
    it('should revert if order buyer is not the caller', async () => {
      await expectRevert(otcWrapperProxy.undoOrder(1, { from: random }), 'OTCWrapper: only buyer can undo the order')
    })
    it('successfully cancels an order via direct call', async () => {
      // create a new order
      await otcWrapperProxy.placeOrder(weth.address, true, 1, expiry, 0, parseUnits('100', 8), {
        from: user,
      })

      assert.equal((await otcWrapperProxy.orderStatus(2)).toString(), '1')

      const tx = await otcWrapperProxy.undoOrder(2, { from: user })

      assert.equal((await otcWrapperProxy.orderStatus(2)).toString(), '0')

      // emits event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), '2')
    })
    it('successfully cancels an order via minimal fowarder call', async () => {
      // create a new order
      await otcWrapperProxy.placeOrder(weth.address, true, 1, expiry, 0, parseUnits('100', 8), {
        from: user,
      })
      assert.equal((await otcWrapperProxy.latestOrder()).toString(), '5')

      const randomBuffer = Buffer.alloc(32, 'dsaas')
      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      const orderId = 5

      const dataExample = [orderId]

      let ABI = ['function undoOrder(uint256 _orderID)']
      let iface = new ethers.utils.Interface(ABI)

      const callData = iface.encodeFunctionData('undoOrder', dataExample)

      const forwardRequest = {
        from: user,
        to: otcWrapperProxy.address,
        value: 0,
        gas: 3000000,
        nonce: 1,
        data: callData,
      }

      const data = signatureData3
      const signature = ethSigUtil.signTypedMessage(userWallet.getPrivateKey(), { data })

      assert.equal((await otcWrapperProxy.orderStatus(5)).toString(), '1')

      await minimalForwarder.execute(forwardRequest, signature, { from: user })

      assert.equal((await otcWrapperProxy.orderStatus(5)).toString(), '0')
    })
    it('should revert if orderID is higher than lastest order or the order status is not pending', async () => {
      // Inexistent order
      await expectRevert(
        otcWrapperProxy.depositCollateral(20, 1, mmSignatureEmpty, { from: marketMaker }),
        'OTCWrapper: inexistent or unsuccessful order',
      )

      // Failed order
      assert.equal((await otcWrapperProxy.orderStatus(2)).toString(), '0')

      await expectRevert(
        otcWrapperProxy.depositCollateral(2, 1, mmSignatureEmpty, { from: marketMaker }),
        'OTCWrapper: inexistent or unsuccessful order',
      )
    })
  })

  describe('Execute order', () => {
    it('should revert if orderID is higher than lastest order or the order status is not pending', async () => {
      // Inexistent order
      await expectRevert(
        otcWrapperProxy.depositCollateral(20, 1, mmSignatureEmpty, { from: marketMaker }),
        'OTCWrapper: inexistent or unsuccessful order',
      )

      // Failed order
      assert.equal((await otcWrapperProxy.orderStatus(2)).toString(), '0')

      await expectRevert(
        otcWrapperProxy.depositCollateral(2, 1, mmSignatureEmpty, { from: marketMaker }),
        'OTCWrapper: inexistent or unsuccessful order',
      )
    })
    it('should revert if market maker is not whitelisted', async () => {
      await expectRevert(
        otcWrapperProxy.executeOrder(1, userSignature1, mmSignatureUSDC1, 1, usdc.address, 1, {
          from: random,
        }),
        'OTCWrapper: address not whitelisted marketmaker',
      )
    })
    it('should revert if user permit amount is lower than premium', async () => {
      await expectRevert(
        otcWrapperProxy.executeOrder(1, userSignature1, mmSignatureUSDC1, parseUnits('200000', 6), usdc.address, 1, {
          from: marketMaker,
        }),
        'OTCWrapper: insufficient amount',
      )
    })
    it('should revert if the user permit signer is not the order buyer', async () => {
      await otcWrapperProxy.placeOrder(weth.address, true, 1, expiry, 0, parseUnits('100', 8), {
        from: random,
      })
      await expectRevert(
        otcWrapperProxy.executeOrder(6, userSignature1, mmSignatureUSDC1, 1, usdc.address, 1, {
          from: marketMaker,
        }),
        'OTCWrapper: signer is not the buyer',
      )
    })
    it('should revert if the user signature amount is not equal to the original premium amount of when the order was placed', async () => {
      await expectRevert(
        otcWrapperProxy.executeOrder(
          1,
          userSignature4,
          mmSignatureUSDC1,
          parseUnits('7000', 6),
          ZERO_ADDR,
          parseUnits('11501', 6),
          {
            from: marketMaker,
          },
        ),
        'OTCWrapper: invalid signature amount',
      )
    })
    it('should revert if the collateral asset is not whitelisted', async () => {
      await expectRevert(
        otcWrapperProxy.executeOrder(
          1,
          userSignature1,
          mmSignatureUSDC1,
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
      await expectRevert(
        otcWrapperProxy.executeOrder(
          1,
          userSignature1,
          mmSignatureUSDC1,
          parseUnits('5000', 6),
          usdc.address,
          parseUnits('14999', 6),
          {
            from: marketMaker,
          },
        ),
        'OTCWrapper: insufficient collateral',
      )
    })
    it('should revert if market maker signature is not from msgSender()', async () => {
      await expectRevert(
        otcWrapperProxy.executeOrder(
          1,
          userSignature1,
          userSignature2,
          parseUnits('5000', 6),
          usdc.address,
          parseUnits('14999', 6),
          {
            from: marketMaker,
          },
        ),
        'OTCWrapper: signer is not the market maker',
      )
    })
    it('should revert if price changed significnatly and notional value is no longer valid', async () => {
      // sudden price drop
      await oracle.setRealTimePrice(weth.address, scaleBigNum(300, 8))

      await expectRevert(
        otcWrapperProxy.executeOrder(
          1,
          userSignature1,
          mmSignatureUSDC1,
          parseUnits('5000', 6),
          usdc.address,
          parseUnits('11501', 6),
          {
            from: marketMaker,
          },
        ),
        'OTCWrapper: invalid notional value',
      )

      // price restores
      await oracle.setRealTimePrice(weth.address, scaleBigNum(1500, 8))
    })

    it('successfully executes call with collateral in USDC via direct call', async () => {
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
      const collateralAmount = parseUnits('15001', 6)
      const orderFee = parseUnits('150000', 6).div(100) // fee is set at 1% of notional
      const mintAmount = parseUnits('100', 8)

      const userBalBeforeUSDC = new BigNumber(await usdc.balanceOf(user))
      const beneficiaryBalBeforeUSDC = new BigNumber(await usdc.balanceOf(beneficiary))
      const mmBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marketMaker))
      const marginPoolBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))

      // call execute
      const tx = await otcWrapperProxy.executeOrder(
        1,
        userSignature1,
        mmSignatureUSDC1,
        premium,
        usdc.address,
        collateralAmount,
        {
          from: marketMaker,
        },
      )

      // set maintenance after opening a vault
      await marginRequirements.setMaintenanceMargin(1, parseUnits('1000', 6), { from: keeper })

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
      assert.equal(
        mmBalBeforeUSDC.minus(mmBalAfterUSDC).toString(),
        collateralAmount.sub(premium).add(orderFee).toString(),
      )
      assert.equal(marginPoolBalAfterUSDC.minus(marginPoolBalBeforeUSDC).toString(), collateralAmount.toString())
      // vault data
      const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(otcWrapperProxy.address))
      const vault = await controllerProxy.getVaultWithDetails(otcWrapperProxy.address, vaultCounter)
      assert.equal(new BigNumber(vault[0].shortAmounts[0]).toString(), mintAmount.toString())
      assert.equal(vault[0].shortOtokens[0].toString(), newOtoken.address)
      assert.equal(new BigNumber(vault[0].collateralAmounts[0]).toString(), collateralAmount.toString())
      assert.equal(vault[0].collateralAssets[0].toString(), usdc.address)

      // order accounting
      assert.equal((await otcWrapperProxy.ordersByAcct(marketMaker, 0)).toString(), '1')
      assert.equal((await otcWrapperProxy.orders(1))[5].toString(), premium.toString())
      assert.equal((await otcWrapperProxy.orders(1))[1].toString(), usdc.address)
      assert.equal((await otcWrapperProxy.orders(1))[8].toString(), marketMaker)
      assert.equal((await otcWrapperProxy.orders(1))[9].toString(), '1')
      assert.equal((await otcWrapperProxy.orderStatus(1)).toString(), '2')
      assert.equal((await otcWrapperProxy.orders(1))[6].toString(), parseUnits('150000', 6).toString())

      // emits event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), '1')
      assert.equal(logs[0].args.collateralAsset.toString(), usdc.address)
      assert.equal(logs[0].args.premium.toString(), premium)
      assert.equal(logs[0].args.seller.toString(), marketMaker)
      assert.equal(logs[0].args.vaultID.toString(), '1')
      assert.equal(logs[0].args.oToken.toString(), (await otcWrapperProxy.orders(1))[10].toString())
      assert.equal(logs[0].args.initialMargin.toString(), collateralAmount)
    })
    it('successfully executes a put with collateral in WBTC via direct call', async () => {
      // user places a new order
      const strikePrice = scaleBigNum(1300, 8)
      const notional = parseUnits('300000', 6)
      const size = parseUnits('200', 8)

      await otcWrapperProxy.placeOrder(weth.address, true, strikePrice, expiry, parseUnits('5000', 6), size, {
        from: user,
      })

      assert.equal((await otcWrapperProxy.latestOrder()).toString(), '7')

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
      const mintAmount = parseUnits('200', 8)

      const userBalBeforeUSDC = new BigNumber(await usdc.balanceOf(user))
      const beneficiaryBalBeforeUSDC = new BigNumber(await usdc.balanceOf(beneficiary))
      const mmBalBeforeWBTC = new BigNumber(await wbtc.balanceOf(marketMaker))
      const marginPoolBalBeforeWBTC = new BigNumber(await wbtc.balanceOf(marginPool.address))
      const mmBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marketMaker))

      // market maker approves wrapper contract beforehand
      await wbtc.approve(otcWrapperProxy.address, collateralAmount, { from: marketMaker })

      // call execute
      const tx = await otcWrapperProxy.executeOrder(
        7,
        userSignature2,
        mmSignatureEmpty,
        premium,
        wbtc.address,
        collateralAmount,
        {
          from: marketMaker,
        },
      )

      // set maintenance after opening a vault
      await marginRequirements.setMaintenanceMargin(7, parseUnits('1', 7), { from: keeper }) // 0.1 WBTC

      const newOtoken = await MockERC20.at((await otcWrapperProxy.orders(7))[10].toString())
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
      assert.equal(marginPoolBalAfterWBTC.minus(marginPoolBalBeforeWBTC).toString(), collateralAmount.toString())
      assert.equal(mmBalAfterUSDC.minus(mmBalBeforeUSDC).toString(), premium.sub(orderFee).toString())

      // vault data
      const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(otcWrapperProxy.address))
      const vault = await controllerProxy.getVaultWithDetails(otcWrapperProxy.address, vaultCounter)
      assert.equal(new BigNumber(vault[0].shortAmounts[0]).toString(), mintAmount.toString())
      assert.equal(vault[0].shortOtokens[0].toString(), newOtoken.address)
      assert.equal(new BigNumber(vault[0].collateralAmounts[0]).toString(), collateralAmount)
      assert.equal(vault[0].collateralAssets[0].toString(), wbtc.address)

      // order accounting
      assert.equal((await otcWrapperProxy.ordersByAcct(marketMaker, 1)).toString(), '7')
      assert.equal((await otcWrapperProxy.orders(7))[5].toString(), premium.toString())
      assert.equal((await otcWrapperProxy.orders(7))[1].toString(), wbtc.address)
      assert.equal((await otcWrapperProxy.orders(7))[8].toString(), marketMaker)
      assert.equal((await otcWrapperProxy.orders(7))[9].toString(), '2')
      assert.equal((await otcWrapperProxy.orderStatus(7)).toString(), '2')
      assert.equal((await otcWrapperProxy.orders(7))[6].toString(), notional.toString())

      // emits event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), '7')
      assert.equal(logs[0].args.collateralAsset.toString(), wbtc.address)
      assert.equal(logs[0].args.premium.toString(), premium)
      assert.equal(logs[0].args.seller.toString(), marketMaker)
      assert.equal(logs[0].args.vaultID.toString(), '2')
      assert.equal(logs[0].args.oToken.toString(), (await otcWrapperProxy.orders(7))[10].toString())
      assert.equal(logs[0].args.initialMargin.toString(), collateralAmount)
    })
    it('successfully executes call with a repeated oToken via minimal forwarder', async () => {
      const randomBuffer = Buffer.alloc(32, 'abc')
      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      // place repeated order
      const strikePrice = scaleBigNum(1300, 8)
      const notional = parseUnits('150000', 6)
      const size = parseUnits('100', 8)

      await otcWrapperProxy.placeOrder(weth.address, false, strikePrice, expiry, parseUnits('5000', 6), size, {
        from: user,
      })

      const premium = parseUnits('5000', 6)
      const collateralAmount = parseUnits('15001', 6)
      const orderFee = parseUnits('150000', 6).div(100) // fee is set at 1% of notional
      const mintAmount = parseUnits('100', 8)
      const orderId = 8

      const dataExample = [orderId, userSignature3, mmSignatureUSDC2, premium, usdc.address, collateralAmount]

      let iface = new ethers.utils.Interface(executeOrderABI)

      const callData = iface.encodeFunctionData('executeOrder', dataExample)

      const forwardRequest = {
        from: marketMaker,
        to: otcWrapperProxy.address,
        value: 0,
        gas: 3000000,
        nonce: 0,
        data: callData,
      }

      const data = signatureData6
      const signature = ethSigUtil.signTypedMessage(userWallet.getPrivateKey(), { data })

      const userBalBeforeUSDC = new BigNumber(await usdc.balanceOf(user))
      const beneficiaryBalBeforeUSDC = new BigNumber(await usdc.balanceOf(beneficiary))
      const mmBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marketMaker))
      const marginPoolBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))

      // call execute
      await minimalForwarder.execute(forwardRequest, signature, { from: marketMaker })

      // set maintenance after opening a vault
      await marginRequirements.setMaintenanceMargin(8, parseUnits('1000', 6), { from: keeper })

      const newOtoken = await MockERC20.at((await otcWrapperProxy.orders(8))[10].toString())
      const userBalAfterOtoken = new BigNumber(await newOtoken.balanceOf(user))
      const userBalAfterUSDC = new BigNumber(await usdc.balanceOf(user))
      const beneficiaryBalAfterUSDC = new BigNumber(await usdc.balanceOf(beneficiary))
      const mmBalAfterUSDC = new BigNumber(await usdc.balanceOf(marketMaker))
      const marginPoolBalAfterUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))

      // token flows
      assert.equal(userBalBeforeUSDC.minus(userBalAfterUSDC).toString(), premium)
      assert.equal(beneficiaryBalAfterUSDC.minus(beneficiaryBalBeforeUSDC).toString(), orderFee.toString())
      assert.equal(
        mmBalBeforeUSDC.minus(mmBalAfterUSDC).toString(),
        collateralAmount.sub(premium).add(orderFee).toString(),
      )
      assert.equal(marginPoolBalAfterUSDC.minus(marginPoolBalBeforeUSDC).toString(), collateralAmount.toString())

      // vault data
      const vaultCounter = new BigNumber(await controllerProxy.getAccountVaultCounter(otcWrapperProxy.address))
      const vault = await controllerProxy.getVaultWithDetails(otcWrapperProxy.address, vaultCounter)
      assert.equal(new BigNumber(vault[0].shortAmounts[0]).toString(), mintAmount.toString())
      assert.equal(vault[0].shortOtokens[0].toString(), newOtoken.address)
      assert.equal(new BigNumber(vault[0].collateralAmounts[0]).toString(), collateralAmount.toString())
      assert.equal(vault[0].collateralAssets[0].toString(), usdc.address)

      // order accounting
      assert.equal((await otcWrapperProxy.ordersByAcct(marketMaker, 2)).toString(), '8')
      assert.equal((await otcWrapperProxy.orders(8))[5].toString(), premium.toString())
      assert.equal((await otcWrapperProxy.orders(8))[1].toString(), usdc.address)
      assert.equal((await otcWrapperProxy.orders(8))[8].toString(), marketMaker)
      assert.equal((await otcWrapperProxy.orders(8))[9].toString(), '3')
      assert.equal((await otcWrapperProxy.orderStatus(8)).toString(), '2')
      assert.equal((await otcWrapperProxy.orders(8))[6].toString(), notional.toString())

      // ensure otoken address is repeated
      assert.equal((await otcWrapperProxy.orders(1))[10].toString(), (await otcWrapperProxy.orders(8))[10].toString())
      assert.equal(userBalAfterOtoken.toString(), mintAmount.mul(2).toString())
    })
    it('should revert if fill deadline has passed', async () => {
      // place new order
      await otcWrapperProxy.placeOrder(weth.address, false, 1, expiry, parseUnits('5000', 6), parseUnits('100', 8), {
        from: user,
      })

      // past fill deadline time
      await time.increase(601)

      await expectRevert(
        otcWrapperProxy.executeOrder(9, userSignature1, mmSignatureUSDC1, 1, usdc.address, 1, {
          from: marketMaker,
        }),
        'OTCWrapper: deadline has passed',
      )
    })
  })

  describe('Deposit collateral', () => {
    it('should revert if orderID is higher than lastest order or the order status is not succeeded', async () => {
      // Inexistent order
      await expectRevert(
        otcWrapperProxy.depositCollateral(20, 1, mmSignatureEmpty, { from: marketMaker }),
        'OTCWrapper: inexistent or unsuccessful order',
      )

      // Failed order
      assert.equal((await otcWrapperProxy.orderStatus(2)).toString(), '0')

      await expectRevert(
        otcWrapperProxy.depositCollateral(2, 1, mmSignatureEmpty, { from: marketMaker }),
        'OTCWrapper: inexistent or unsuccessful order',
      )
    })
    it('should revert if seller is not the caller', async () => {
      await expectRevert(
        otcWrapperProxy.depositCollateral(1, 1, userSignature1, { from: user }),
        'OTCWrapper: sender is not the order seller',
      )
    })
    it('should revert if market maker signature is not from msgSender()', async () => {
      await expectRevert(
        otcWrapperProxy.depositCollateral(1, 1, userSignature1, { from: marketMaker }),
        'OTCWrapper: signer is not the market maker',
      )
    })
    it('market maker successfully deposits collateral via direct call', async () => {
      const depositAmount = parseUnits('2000', 6) // 2000 USDC

      const vaultBefore = await controllerProxy.getVaultWithDetails(otcWrapperProxy.address, 1)

      const vaultCollateralBefore = new BigNumber(vaultBefore[0].collateralAmounts[0])
      const marketMakerBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marketMaker))
      const marginPoolBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))

      // call deposit collateral
      const tx = await otcWrapperProxy.depositCollateral(1, depositAmount, mmSignatureUSDC3, { from: marketMaker })

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
      assert.equal(logs[0].args.acct.toString(), marketMaker)
    })
    it('market maker successfully deposits collateral via minimal forwarder', async () => {
      const randomBuffer = Buffer.alloc(32, 'abc')
      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      const orderId = 7
      const depositAmount = 100000000 // 1 WBTC

      const dataExample = [orderId, depositAmount, mmSignatureEmpty]

      let ABI = depositCollateralABI
      let iface = new ethers.utils.Interface(ABI)

      const callData = iface.encodeFunctionData('depositCollateral', dataExample)

      const forwardRequest = {
        from: marketMaker,
        to: otcWrapperProxy.address,
        value: 0,
        gas: 3000000,
        nonce: 1,
        data: callData,
      }

      const data = signatureData4
      const signature = ethSigUtil.signTypedMessage(userWallet.getPrivateKey(), { data })

      // fund btc
      await wbtc.mint(marketMaker, createTokenAmount(2, WBTCDECIMALS))

      const vaultBefore = await controllerProxy.getVaultWithDetails(otcWrapperProxy.address, 2)
      const vaultCollateralBefore = new BigNumber(vaultBefore[0].collateralAmounts[0])
      const marketMakerBalBeforeWBTC = new BigNumber(await wbtc.balanceOf(marketMaker))
      const marginPoolBalBeforeWBTC = new BigNumber(await wbtc.balanceOf(marginPool.address))

      // approve
      await wbtc.approve(otcWrapperProxy.address, depositAmount, { from: marketMaker })

      // call deposit collateral
      await minimalForwarder.execute(forwardRequest, signature, { from: marketMaker })

      const vaultAfter = await controllerProxy.getVaultWithDetails(otcWrapperProxy.address, 2)
      const vaultCollateralAfter = new BigNumber(vaultAfter[0].collateralAmounts[0])
      const marketMakerBalAfterWBTC = new BigNumber(await wbtc.balanceOf(marketMaker))
      const marginPoolBalAfterWBTC = new BigNumber(await wbtc.balanceOf(marginPool.address))

      // token flows
      assert.equal(vaultCollateralAfter.minus(vaultCollateralBefore).toString(), depositAmount.toString())
      assert.equal(marketMakerBalBeforeWBTC.minus(marketMakerBalAfterWBTC).toString(), depositAmount.toString())
      assert.equal(marginPoolBalAfterWBTC.minus(marginPoolBalBeforeWBTC).toString(), depositAmount.toString())
    })
  })

  describe('Withdraw collateral', () => {
    it('should revert if orderID is higher than lastest order  or the order status is not succeeded', async () => {
      // Inexistent order
      await expectRevert(
        otcWrapperProxy.withdrawCollateral(20, 1, { from: marketMaker }),
        'OTCWrapper: inexistent or unsuccessful order',
      )

      // Failed order
      assert.equal((await otcWrapperProxy.orderStatus(2)).toString(), '0')

      await expectRevert(
        otcWrapperProxy.withdrawCollateral(2, 1, { from: marketMaker }),
        'OTCWrapper: inexistent or unsuccessful order',
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
        otcWrapperProxy.withdrawCollateral(1, parseUnits('1002', 6), { from: marketMaker }),
        'OTCWrapper: insufficient collateral',
      )
    })
    it('should revert if withdrawAmount + maintenanceMargin > collateral in vault', async () => {
      await expectRevert(
        otcWrapperProxy.withdrawCollateral(1, parseUnits('16001', 6), { from: marketMaker }),
        'OTCWrapper: insufficient collateral',
      )
    })
    it('should revert if USDC depegs', async () => {
      // USDC depegs to 0.5
      await oracle.setRealTimePrice(usdc.address, scaleBigNum(5, 7))

      // Maintenance margin adjusts to new depegged price - increases by 2x
      await marginRequirements.setMaintenanceMargin(1, parseUnits('2000', 6), { from: keeper })

      await expectRevert(
        otcWrapperProxy.withdrawCollateral(1, parseUnits('1000', 6), { from: marketMaker }),
        'OTCWrapper: insufficient collateral',
      )
    })
    it('market maker successfully withdraws collateral via direct call', async () => {
      // USDC repegs to 1
      await oracle.setRealTimePrice(usdc.address, scaleBigNum(1, 8))

      // Maintenance margin adjusts to new repegged price - falls by 50%
      await marginRequirements.setMaintenanceMargin(1, parseUnits('1000', 6), { from: keeper })

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
      assert.equal(logs[0].args.acct.toString(), marketMaker)
    })
    it('market maker successfully withdraws collateral via minimal forwarder', async () => {
      const randomBuffer = Buffer.alloc(32, 'abc')
      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      const orderId = 7
      const withdrawAmount = 100000000 // 1 WBTC

      const dataExample = [orderId, withdrawAmount]

      let ABI = ['function withdrawCollateral(uint256 _orderID, uint256 _amount)']
      let iface = new ethers.utils.Interface(ABI)

      const callData = iface.encodeFunctionData('withdrawCollateral', dataExample)

      const forwardRequest = {
        from: marketMaker,
        to: otcWrapperProxy.address,
        value: 0,
        gas: 3000000,
        nonce: 2,
        data: callData,
      }

      const data = signatureData5
      const signature = ethSigUtil.signTypedMessage(userWallet.getPrivateKey(), { data })

      const vaultBefore = await controllerProxy.getVaultWithDetails(otcWrapperProxy.address, 2)
      const vaultCollateralBefore = new BigNumber(vaultBefore[0].collateralAmounts[0])
      const marketMakerBalBeforeWBTC = new BigNumber(await wbtc.balanceOf(marketMaker))
      const marginPoolBalBeforeWBTC = new BigNumber(await wbtc.balanceOf(marginPool.address))

      // call withdraw collateral
      await minimalForwarder.execute(forwardRequest, signature, { from: marketMaker })

      const vaultAfter = await controllerProxy.getVaultWithDetails(otcWrapperProxy.address, 2)
      const vaultCollateralAfter = new BigNumber(vaultAfter[0].collateralAmounts[0])
      const marketMakerBalAfterWBTC = new BigNumber(await wbtc.balanceOf(marketMaker))
      const marginPoolBalAfterWBTC = new BigNumber(await wbtc.balanceOf(marginPool.address))

      // token flows
      assert.equal(vaultCollateralBefore.minus(vaultCollateralAfter).toString(), withdrawAmount.toString())
      assert.equal(marketMakerBalAfterWBTC.minus(marketMakerBalBeforeWBTC).toString(), withdrawAmount.toString())
      assert.equal(marginPoolBalBeforeWBTC.minus(marginPoolBalAfterWBTC).toString(), withdrawAmount.toString())
    })
  })

  describe('Settle vault', () => {
    it('should revert if orderID is higher than lastest order or the order status is not succeeded', async () => {
      // Inexistent order
      await expectRevert(
        otcWrapperProxy.settleVault(20, { from: marketMaker }),
        'OTCWrapper: inexistent or unsuccessful order',
      )

      // Failed order
      assert.equal((await otcWrapperProxy.orderStatus(2)).toString(), '0')

      await expectRevert(
        otcWrapperProxy.settleVault(2, { from: marketMaker }),
        'OTCWrapper: inexistent or unsuccessful order',
      )
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
    it('market maker successfully settles after expiry ITM via direct call and user redeems otokens', async () => {
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

      const collateralToWithdraw = createTokenAmount(6001, USDCDECIMALS)

      const marginPoolBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))
      const marketMakerBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marketMaker))

      assert.isAbove((await marginRequirements.maintenanceMargin(1)).toNumber(), 0)

      // call settle vault
      const tx = await otcWrapperProxy.settleVault(1, { from: marketMaker })

      const marginPoolBalAfterUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))
      const marketMakerBalAfterUSDC = new BigNumber(await usdc.balanceOf(marketMaker))

      // token flows
      assert.equal(marketMakerBalAfterUSDC.minus(marketMakerBalBeforeUSDC).toString(), collateralToWithdraw.toString())
      assert.equal(marginPoolBalBeforeUSDC.minus(marginPoolBalAfterUSDC).toString(), collateralToWithdraw.toString())

      // emits event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), '1')
    })
    it('market maker successfully settles after expiry OTM via direct call', async () => {
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

      assert.isAbove((await marginRequirements.maintenanceMargin(7)).toNumber(), 0)

      // call settle vault
      const tx = await otcWrapperProxy.settleVault(7, { from: marketMaker })

      const marginPoolBalAfterWBTC = new BigNumber(await wbtc.balanceOf(marginPool.address))
      const marketMakerBalAfterWBTC = new BigNumber(await wbtc.balanceOf(marketMaker))

      // token flows
      assert.equal(marketMakerBalAfterWBTC.minus(marketMakerBalBeforeWBTC).toString(), collateralToWithdraw.toString())
      assert.equal(marginPoolBalBeforeWBTC.minus(marginPoolBalAfterWBTC).toString(), collateralToWithdraw.toString())
      assert.equal(marginPoolBalAfterWBTC.toString(), '0')

      // emits event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), '7')
    })
    it('market maker successfully settles after expiry OTM via minimal forwarder', async () => {
      const randomBuffer = Buffer.alloc(32, 'abc')
      const userWallet = Wallet.fromPrivateKey(randomBuffer)

      const orderId = 8

      const dataExample = [orderId]

      let ABI = ['function settleVault(uint256 _orderID)']
      let iface = new ethers.utils.Interface(ABI)

      const callData = iface.encodeFunctionData('settleVault', dataExample)

      const forwardRequest = {
        from: marketMaker,
        to: otcWrapperProxy.address,
        value: 0,
        gas: 3000000,
        nonce: 3,
        data: callData,
      }

      const data = signatureData7
      const signature = ethSigUtil.signTypedMessage(userWallet.getPrivateKey(), { data })

      // past time after expiry
      await time.increase(8600000)

      //set finalized prices
      await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, createTokenAmount(1299), true)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createTokenAmount(1), true)

      // isPut = false
      // Strike price = 1300
      // Expiry price = 1299
      // nr of otokens = 100
      // user payout = 0 | OTM
      // collateral in vault = 15001 USDC
      // collateral free to be withdrawn by MM = 15001 - 0 = 15001 USDC

      const collateralToWithdraw = createTokenAmount(15001, USDCDECIMALS)

      const marginPoolBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))
      const marketMakerBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marketMaker))

      assert.isAbove((await marginRequirements.maintenanceMargin(7)).toNumber(), 0)

      // call settle vault
      await minimalForwarder.execute(forwardRequest, signature, { from: marketMaker })

      const marginPoolBalAfterUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))
      const marketMakerBalAfterUSDC = new BigNumber(await usdc.balanceOf(marketMaker))

      // token flows
      assert.equal(marketMakerBalAfterUSDC.minus(marketMakerBalBeforeUSDC).toString(), collateralToWithdraw.toString())
      assert.equal(marginPoolBalBeforeUSDC.minus(marginPoolBalAfterUSDC).toString(), collateralToWithdraw.toString())
    })
  })

  describe('Redeem', () => {
    it('should revert if there is a direct call to redeem on controller instead of via the wrapper contract', async () => {
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

      await expectRevert(controllerProxy.operate(redeemArgs, { from: user }), 'C39')
    })
    it('should revert if orderID is higher than lastest order or the order status is not succeeded', async () => {
      // Inexistent order
      await expectRevert(
        otcWrapperProxy.settleVault(20, { from: marketMaker }),
        'OTCWrapper: inexistent or unsuccessful order',
      )

      // Failed order
      assert.equal((await otcWrapperProxy.orderStatus(2)).toString(), '0')

      await expectRevert(
        otcWrapperProxy.settleVault(2, { from: marketMaker }),
        'OTCWrapper: inexistent or unsuccessful order',
      )
    })
    it('should revert if buyer is not the caller', async () => {
      await expectRevert(otcWrapperProxy.redeem(1, { from: random }), 'OTCWrapper: sender is not the order buyer')
    })
    it('no collateral amounts are redeemed if buyer tries to redeem before or after the vault was settled OTM', async () => {
      const strikePrice = scaleBigNum(1300, 8)
      // notional = parseUnits('150000', 6)
      const size = parseUnits('100', 8)
      const premium = parseUnits('5000', 6)
      const collateralAmount = parseUnits('15001', 6)
      const expiry = createValidExpiry(Number(await time.latest()), 10)

      await otcWrapperProxy.placeOrder(weth.address, false, strikePrice, expiry, parseUnits('5000', 6), size, {
        from: user,
      })

      const orderID = await otcWrapperProxy.latestOrder()

      await otcWrapperProxy.executeOrder(
        orderID,
        userSignature5,
        mmSignatureUSDC4,
        premium,
        usdc.address,
        collateralAmount,
        {
          from: marketMaker,
        },
      )

      // move to past expiry date
      await time.increase(8600000)

      // set expiry to OTM
      await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, createTokenAmount(1299), true)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createTokenAmount(1), true)

      // approve
      const otoken = await MockERC20.at((await otcWrapperProxy.orders(orderID))[10].toString())
      await otoken.approve(otcWrapperProxy.address, size, { from: user })

      const marginPoolBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))
      const userBalBeforeUSDC = new BigNumber(await usdc.balanceOf(user))
      const userBalBeforeOtoken = new BigNumber(await otoken.balanceOf(user))

      await otcWrapperProxy.redeem(orderID, { from: user })

      const marginPoolBalAfterUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))
      const userBalAfterUSDC = new BigNumber(await usdc.balanceOf(user))
      const userBalAfterOtoken = new BigNumber(await otoken.balanceOf(user))

      assert.equal(marginPoolBalBeforeUSDC.minus(marginPoolBalAfterUSDC).toString(), '0')
      assert.equal(userBalAfterUSDC.minus(userBalBeforeUSDC).toString(), '0')
      assert.equal(userBalBeforeOtoken.minus(userBalAfterOtoken).toString(), size.toString())

      await otcWrapperProxy.settleVault(orderID, { from: marketMaker })

      const marginPoolBalBeforeUSDC2 = new BigNumber(await usdc.balanceOf(marginPool.address))
      const userBalBeforeUSDC2 = new BigNumber(await usdc.balanceOf(user))
      const userBalBeforeOtoken2 = new BigNumber(await otoken.balanceOf(user))

      await otcWrapperProxy.redeem(orderID, { from: user })

      const marginPoolBalAfterUSDC2 = new BigNumber(await usdc.balanceOf(marginPool.address))
      const userBalAfterUSDC2 = new BigNumber(await usdc.balanceOf(user))
      const userBalAfterOtoken2 = new BigNumber(await otoken.balanceOf(user))

      assert.equal(marginPoolBalBeforeUSDC2.minus(marginPoolBalAfterUSDC2).toString(), '0')
      assert.equal(userBalAfterUSDC2.minus(userBalBeforeUSDC2).toString(), '0')
      assert.equal(userBalBeforeOtoken2.minus(userBalAfterOtoken2).toString(), '0')
    })

    it('user successfully redeems before vault is settled', async () => {
      const strikePrice = scaleBigNum(1300, 8)
      // notional = parseUnits('150000', 6)
      const size = parseUnits('100', 8)
      const premium = parseUnits('5000', 6)
      const collateralAmount = parseUnits('15001', 6)
      const payout = parseUnits('10000', 6)
      const expiry = createValidExpiry(Number(await time.latest()), 10)

      await otcWrapperProxy.placeOrder(weth.address, false, strikePrice, expiry, parseUnits('5000', 6), size, {
        from: user,
      })

      const orderID = await otcWrapperProxy.latestOrder()

      await otcWrapperProxy.executeOrder(
        orderID,
        userSignature6,
        mmSignatureUSDC5,
        premium,
        usdc.address,
        collateralAmount,
        {
          from: marketMaker,
        },
      )

      // move to past expiry date
      await time.increase(8600000)

      // set expiry to ITM with enough collateral
      await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, createTokenAmount(1400), true)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createTokenAmount(1), true)

      // approve
      const otoken = await MockERC20.at((await otcWrapperProxy.orders(orderID))[10].toString())
      await otoken.approve(otcWrapperProxy.address, size, { from: user })

      // call redeem
      const marginPoolBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))
      const userBalBeforeUSDC = new BigNumber(await usdc.balanceOf(user))
      const userBalBeforeOtoken = new BigNumber(await otoken.balanceOf(user))

      const tx = await otcWrapperProxy.redeem(orderID, { from: user })

      const marginPoolBalAfterUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))
      const userBalAfterUSDC = new BigNumber(await usdc.balanceOf(user))
      const userBalAfterOtoken = new BigNumber(await otoken.balanceOf(user))

      assert.equal(marginPoolBalBeforeUSDC.minus(marginPoolBalAfterUSDC).toString(), payout.toString())
      assert.equal(userBalAfterUSDC.minus(userBalBeforeUSDC).toString(), payout.toString())
      assert.equal(userBalBeforeOtoken.minus(userBalAfterOtoken).toString(), size.toString())

      // event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), orderID.toString())
      assert.equal(logs[0].args.size.toString(), size.toString())

      // settle vault after redeem
      const marginPoolBalBeforeUSDC2 = new BigNumber(await usdc.balanceOf(marginPool.address))
      const marketMakerBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marketMaker))

      await otcWrapperProxy.settleVault(orderID, { from: marketMaker })

      const marginPoolBalAfterUSDC2 = new BigNumber(await usdc.balanceOf(marginPool.address))
      const marketMakerBalAfterUSDC = new BigNumber(await usdc.balanceOf(marketMaker))

      assert.equal(
        marketMakerBalAfterUSDC.minus(marketMakerBalBeforeUSDC).toString(),
        collateralAmount.sub(payout).toString(),
      )
      assert.equal(
        marginPoolBalBeforeUSDC2.minus(marginPoolBalAfterUSDC2).toString(),
        collateralAmount.sub(payout).toString(),
      )
    })

    it('should revert if it is ITM and there is not enough collateral in the vault', async () => {
      const strikePrice = scaleBigNum(1300, 8)
      // notional = parseUnits('150000', 6)
      const size = parseUnits('100', 8)
      const premium = parseUnits('5000', 6)
      const collateralAmount = parseUnits('15001', 6)
      const expiry = createValidExpiry(Number(await time.latest()), 10)

      await otcWrapperProxy.placeOrder(weth.address, false, strikePrice, expiry, parseUnits('5000', 6), size, {
        from: user,
      })

      const orderID = await otcWrapperProxy.latestOrder()

      await otcWrapperProxy.executeOrder(
        orderID,
        userSignature7,
        mmSignatureUSDC6,
        premium,
        usdc.address,
        collateralAmount,
        {
          from: marketMaker,
        },
      )

      // move to past expiry date
      await time.increase(8600000)

      // set expiry to ITM without enough collateral
      await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, createTokenAmount(1451), true)
      await oracle.setExpiryPriceFinalizedAllPeiodOver(usdc.address, expiry, createTokenAmount(1), true)

      await expectRevert(
        otcWrapperProxy.redeem(orderID, { from: user }),
        'OTCWrapper: insuficient collateral to redeem',
      )
    })

    it('user successfully redeems after vault is settled', async () => {
      //set finalized prices to same as the moment vault was were settled
      await oracle.setExpiryPriceFinalizedAllPeiodOver(weth.address, expiry, createTokenAmount(1400), true)

      const userPayout = createTokenAmount(10000, USDCDECIMALS)
      const otoken = await MockERC20.at((await otcWrapperProxy.orders(1))[10].toString())
      const size = createTokenAmount(100)

      const marginPoolBalBeforeUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))
      const userBalBeforeUSDC = new BigNumber(await usdc.balanceOf(user))
      const userBalBeforeOtoken = new BigNumber(await otoken.balanceOf(user))

      await otoken.approve(otcWrapperProxy.address, size, { from: user })

      const tx = await otcWrapperProxy.redeem(1, { from: user })

      const marginPoolBalAfterUSDC = new BigNumber(await usdc.balanceOf(marginPool.address))
      const userBalAfterUSDC = new BigNumber(await usdc.balanceOf(user))
      const userBalAfterOtoken = new BigNumber(await otoken.balanceOf(user))

      assert.equal(marginPoolBalBeforeUSDC.minus(marginPoolBalAfterUSDC).toString(), userPayout.toString())
      assert.equal(userBalAfterUSDC.minus(userBalBeforeUSDC).toString(), userPayout.toString())
      assert.equal(userBalBeforeOtoken.minus(userBalAfterOtoken).toString(), size.toString())

      // event
      const { logs } = tx
      assert.equal(logs[0].args.orderID.toString(), "1")
      assert.equal(logs[0].args.size.toString(), size.toString())
    })
  })

  describe('Upgrade contract to new minimal forwarder', () => {
    it('successfully upgrades the contract to new minimal forwarder and new USDC address', async () => {
      // deploy new forwarder
      newMinimalForwarder = await MinimalForwarder.new()

      // deploy new OTC wrapper implementation pointing to new forwarder
      const newOTCWrapperImplementation = await OTCWrapper.new(newMinimalForwarder.address, random)

      const proxy = await OwnedUpgradeabilityProxy.at(otcWrapperProxy.address)

      // initial state
      assert.equal((await proxy.implementation()).toString(), otcWrapperImplementation.address)
      assert.equal((await otcWrapperProxy.isTrustedForwarder(minimalForwarder.address)).toString(), 'true')
      assert.equal((await otcWrapperProxy.isTrustedForwarder(newMinimalForwarder.address)).toString(), 'false')
      assert.equal((await otcWrapperProxy.USDC()).toString(), usdc.address)

      // upgrade proxy to new OTC wrapper implementation
      await proxy.upgradeTo(newOTCWrapperImplementation.address)

      // final state
      assert.equal((await proxy.implementation()).toString(), newOTCWrapperImplementation.address)
      assert.equal((await otcWrapperProxy.isTrustedForwarder(minimalForwarder.address)).toString(), 'false')
      assert.equal((await otcWrapperProxy.isTrustedForwarder(newMinimalForwarder.address)).toString(), 'true')
      assert.equal((await otcWrapperProxy.USDC()).toString(), random)
    })
  })
})

const executeOrderABI = [
  {
    inputs: [
      { internalType: 'uint256', name: '_orderID', type: 'uint256' },
      {
        components: [
          { internalType: 'uint256', name: 'amount', type: 'uint256' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
          { internalType: 'address', name: 'acct', type: 'address' },
          { internalType: 'uint8', name: 'v', type: 'uint8' },
          { internalType: 'bytes32', name: 'r', type: 'bytes32' },
          { internalType: 'bytes32', name: 's', type: 'bytes32' },
        ],
        internalType: 'struct Permit',
        name: '_userSignature',
        type: 'tuple',
      },
      {
        components: [
          { internalType: 'uint256', name: 'amount', type: 'uint256' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
          { internalType: 'address', name: 'acct', type: 'address' },
          { internalType: 'uint8', name: 'v', type: 'uint8' },
          { internalType: 'bytes32', name: 'r', type: 'bytes32' },
          { internalType: 'bytes32', name: 's', type: 'bytes32' },
        ],
        internalType: 'struct Permit',
        name: '_mmSignature',
        type: 'tuple',
      },
      {
        internalType: 'uint256',
        name: '_premium',
        type: 'uint256',
      },
      {
        internalType: 'address',
        name: '_collateralAsset',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: '_collateralAmount',
        type: 'uint256',
      },
    ],
    name: 'executeOrder',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

const depositCollateralABI = [
  {
    inputs: [
      { internalType: 'uint256', name: '_orderID', type: 'uint256' },
      { internalType: 'uint256', name: '_amount', type: 'uint256' },
      {
        components: [
          { internalType: 'uint256', name: 'amount', type: 'uint256' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
          { internalType: 'address', name: 'acct', type: 'address' },
          { internalType: 'uint8', name: 'v', type: 'uint8' },
          { internalType: 'bytes32', name: 'r', type: 'bytes32' },
          { internalType: 'bytes32', name: 's', type: 'bytes32' },
        ],
        internalType: 'struct Permit',
        name: '_mmSignature',
        type: 'tuple',
      },
    ],
    name: 'depositCollateral',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

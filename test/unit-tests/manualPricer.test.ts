import BigNumber from 'bignumber.js'
import {
  ManualPricerInstance,
  MockOracleInstance,
  MockERC20Instance,
  AddressBookInstance,
} from '../../build/types/truffle-types'

import { createTokenAmount } from '../utils'
const { expectRevert, time } = require('@openzeppelin/test-helpers')

const ManualPricer = artifacts.require('ManualPricer.sol')
const MockOracle = artifacts.require('MockOracle.sol')
const MockERC20 = artifacts.require('MockERC20.sol')
const AddressBook = artifacts.require('AddressBook.sol')

// address(0)
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

contract('ManualPricer', ([owner, bot, random, keeper]) => {
  let oracle: MockOracleInstance
  let weth: MockERC20Instance
  // otoken
  let pricer: ManualPricerInstance
  // addressbook module mock
  let addressbook: AddressBookInstance

  before('Deployment', async () => {
    // deploy mock contracts
    oracle = await MockOracle.new({ from: owner })
    weth = await MockERC20.new('WETH', 'WETH', 18)
    // deploy addressbook
    addressbook = await AddressBook.new()
    // deploy pricer
    pricer = await ManualPricer.new(bot, weth.address, oracle.address, addressbook.address)
    // set keeper in addressbook
    addressbook.setKeeper(keeper)
  })

  describe('constructor', () => {
    it('should set the config correctly', async () => {
      const asset = await pricer.asset()
      assert.equal(asset, weth.address)
      const bot = await pricer.bot()
      assert.equal(bot, bot)
      const oracleModule = await pricer.oracle()
      assert.equal(oracleModule, oracle.address)
      const addressbookModule = await pricer.addressbook()
      assert.equal(addressbookModule, addressbook.address)
    })
    it('should revert if initializing oracle with 0 address', async () => {
      await expectRevert(
        ManualPricer.new(bot, weth.address, ZERO_ADDR, addressbook.address),
        'ManualPricer: Cannot set 0 address as oracle',
      )
    })
    it('should revert if initializing bot with 0 address', async () => {
      await expectRevert(
        ManualPricer.new(ZERO_ADDR, weth.address, oracle.address, addressbook.address),
        'ManualPricer: Cannot set 0 address as bot',
      )
    })
    it('should revert if initializing addressbook with 0 address', async () => {
      await expectRevert(
        ManualPricer.new(bot, weth.address, oracle.address, ZERO_ADDR),
        'ManualPricer: Cannot set 0 address as addressbook',
      )
    })
  })

  describe('setPriceTimeValidity', () => {
    it('should revert if not called by the keeper', async () => {
      await expectRevert(pricer.setPriceTimeValidity(900, { from: random }), 'ManualPricer: sender is not keeper')
    })
    it('should revert if initializing priceTimeValidity with 0', async () => {
      await expectRevert(
        pricer.setPriceTimeValidity(0, { from: keeper }),
        'ManualPricer: price time validity cannot be 0',
      )
    })
    it('should successfully set price time validity to 15 minutes', async () => {
      assert.equal((await pricer.priceTimeValidity()).toString(), '0')

      await pricer.setPriceTimeValidity(900, { from: keeper })

      assert.equal((await pricer.priceTimeValidity()).toString(), '900')
    })
  })

  describe('setDeviationMultiplier', () => {
    it('should revert if not called by the keeper', async () => {
      await expectRevert(pricer.setDeviationMultiplier(3, { from: random }), 'ManualPricer: sender is not keeper')
    })
    it('should revert if initializing deviationMultiplier with 0', async () => {
      await expectRevert(
        pricer.setDeviationMultiplier(0, { from: keeper }),
        'ManualPricer: deviation multiplier cannot be 0',
      )
    })
    it('should successfully set deviation multiplier 1.75', async () => {
      assert.equal((await pricer.deviationMultiplier()).toString(), '0')

      await pricer.setDeviationMultiplier(175, { from: keeper })

      assert.equal((await pricer.deviationMultiplier()).toString(), '175')
    })
  })

  describe('getPrice', () => {
    it('should return the new price after resetting answer', async () => {
      const newPrice = createTokenAmount(200, 8)
      const timestamp = await time.latest()
      await pricer.setExpiryPriceInOracle(timestamp, newPrice, { from: bot })
      const price = await pricer.getPrice()
      const expectedResult = createTokenAmount(200, 8)
      assert.equal(price.toString(), expectedResult.toString())
    })
    it('should revert if price validity time interval has passed', async () => {
      await time.increase(901) // time is past price time validity window

      await expectRevert(pricer.getPrice(), 'ManualPricer: price is no longer valid')
    })
  })

  describe('setExpiryPrice', () => {
    const p1 = createTokenAmount(150.333, 8)

    it('should set the correct price to the oracle', async () => {
      const expiryTimestamp = 5

      await pricer.setExpiryPriceInOracle(expiryTimestamp, p1, { from: bot })
      const priceFromOracle = await oracle.getExpiryPrice(weth.address, expiryTimestamp)
      const lastExpiryTimestamp = await pricer.lastExpiryTimestamp()
      assert.equal(p1.toString(), priceFromOracle[0].toString())
      assert.equal(lastExpiryTimestamp.toString(), expiryTimestamp.toString())
      assert.equal((await pricer.historicalPrice(lastExpiryTimestamp)).toString(), p1.toString())
    })
    it('should revert if sender is not bot address', async () => {
      const expiryTimestamp = 5
      await expectRevert(
        pricer.setExpiryPriceInOracle(expiryTimestamp, p1, { from: random }),
        'ManualPricer: unauthorized sender',
      )
    })
    it('should revert if expiry is in the future', async () => {
      // future timestamp
      const expiryTimestamp = new BigNumber(await time.latest()).plus(1000)

      await expectRevert(
        pricer.setExpiryPriceInOracle(expiryTimestamp, p1, { from: bot }),
        'ManualPricer: expiries prices cannot be set for the future',
      )
    })
    it('should revert if new price deviates more than allowed from previous price', async () => {
      const expiryTimestamp = 5
      const p2 = createTokenAmount(150.333, 7)
      const p3 = createTokenAmount(150.333, 9)

      await expectRevert(
        pricer.setExpiryPriceInOracle(expiryTimestamp, p2, { from: bot }),
        'ManualPricer: price deviation is larger than currently allowed',
      )

       await expectRevert(
        pricer.setExpiryPriceInOracle(expiryTimestamp, p3, { from: bot }),
        'ManualPricer: price deviation is larger than currently allowed',
      ) 
    })
  })

  describe('get historical price', async () => {
    let t0: number
    // p0 = price at t0 ... etc
    const p0 = createTokenAmount(100, 8)

    it('should return historical price with timestamp', async () => {
      await pricer.setExpiryPriceInOracle(0, p0, { from: bot })
      const roundData = await pricer.historicalPrice(0)

      assert.equal(roundData.toString(), p0, 'Historical round price mismatch')
    })

    it('should revert when no data round available', async () => {
      const invalidRoundId = 2
      assert.equal((await pricer.historicalPrice(2)).toString(), '0', 'Historical round timestamp mismatch')
    })
  })
})

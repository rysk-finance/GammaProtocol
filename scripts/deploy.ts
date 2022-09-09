import hre, { ethers } from 'hardhat'
import { createScaledNumber as scaleNum } from '../test/utils'
import { BigNumber, BigNumberish, utils } from 'ethers'
import { AddressBook } from '../types/AddressBook'
import { Whitelist } from '../types/Whitelist'
import { Oracle } from '../types/Oracle'
import { MarginCalculator } from '../types/MarginCalculator'
import { Controller } from '../types/Controller'

// arbitrum rinkeby testnet addresses
const usdcAddress = '0x33a010E74A354bd784a62cca3A4047C1A84Ceeab'
const wethAddress = '0xFCfbfcC11d12bCf816415794E5dc1BBcc5304e01'
const chainlinkOracleAddress = '0x5f0423B1a6935dc5596e7A24d98532b67A0AeFd8'

const chainlinkOracle = '0x5f0423B1a6935dc5596e7A24d98532b67A0AeFd8'
const productSpotShockValue = ethers.utils.parseUnits('0.5', 27)
// array of time to expiry
const day = 60 * 60 * 24
const timeToExpiry = [day * 7, day * 14, day * 28, day * 42, day * 56, day * 70, day * 84]
// array of upper bound value correspond to time to expiry
const expiryToValue = [
  ethers.utils.parseUnits('0.1678', 27),
  ethers.utils.parseUnits('0.237', 27),
  ethers.utils.parseUnits('0.3326', 27),
  ethers.utils.parseUnits('0.4032', 27),
  ethers.utils.parseUnits('0.4603', 27),
  ethers.utils.parseUnits('0.5', 27),
]

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('deployer: ' + (await deployer.getAddress()))
  const usdc = await ethers.getContractAt('MockERC20', usdcAddress)
  const weth = await ethers.getContractAt('MockERC20', wethAddress)

  // // deploy AddressBook & transfer ownership
  const addressbook = await (await ethers.getContractFactory('AddressBook')).deploy()
  console.log('addressbook: ' + addressbook.address)

  try {
    await hre.run('verify:verify', {
      address: addressbook.address,
      constructorArguments: [],
    })
    console.log('addressbook verified')
  } catch (err: any) {
    if (err.message.includes('Reason: Already Verified')) {
      console.log('addressbook contract already verified')
    }
  }

  // // deploy OtokenFactory & set address
  const otokenFactory = await (await ethers.getContractFactory('OtokenFactory')).deploy(addressbook.address)
  console.log('otokenFactory: ' + otokenFactory.address)

  try {
    await hre.run('verify:verify', {
      address: otokenFactory.address,
      constructorArguments: [addressbook.address],
    })
    console.log('otokenFactory verified')
  } catch (err: any) {
    if (err.message.includes('Reason: Already Verified')) {
      console.log('otokenFactory contract already verified')
    }
  }

  await addressbook.setOtokenFactory(otokenFactory.address)

  // // deploy Otoken implementation & set address
  const otoken = await (await ethers.getContractFactory('Otoken')).deploy()
  console.log('otoken: ' + otoken.address)

  try {
    await hre.run('verify:verify', {
      address: otoken.address,
      constructorArguments: [],
    })
    console.log('otoken verified')
  } catch (err: any) {
    if (err.message.includes('Reason: Already Verified')) {
      console.log('otoken contract already verified')
    }
  }

  await addressbook.setOtokenImpl(otoken.address)

  // // deploy Whitelist module & set address
  const whitelist = await (await ethers.getContractFactory('Whitelist')).deploy(addressbook.address)
  console.log('whitelist: ' + whitelist.address)

  try {
    await hre.run('verify:verify', {
      address: whitelist.address,
      constructorArguments: [addressbook.address],
    })
    console.log('whitelist verified')
  } catch (err: any) {
    if (err.message.includes('Reason: Already Verified')) {
      console.log('whitelist contract already verified')
    }
  }

  await addressbook.setWhitelist(whitelist.address)

  // // deploy Oracle module & set address
  const oracle = await (await ethers.getContractFactory('Oracle')).deploy()
  console.log('oracle: ' + oracle.address)

  try {
    await hre.run('verify:verify', {
      address: oracle.address,
      constructorArguments: [],
    })
    console.log('oracle verified')
  } catch (err: any) {
    if (err.message.includes('Reason: Already Verified')) {
      console.log('oracle contract already verified')
    }
  }

  await addressbook.setOracle(oracle.address)

  // // deploy MarginPool module & set address
  const pool = await (await ethers.getContractFactory('MarginPool')).deploy(addressbook.address)
  console.log('pool: ' + pool.address)

  try {
    await hre.run('verify:verify', {
      address: pool.address,
      constructorArguments: [addressbook.address],
    })
    console.log('pool verified')
  } catch (err: any) {
    if (err.message.includes('Reason: Already Verified')) {
      console.log('pool contract already verified')
    }
  }

  await addressbook.setMarginPool(pool.address)

  // deploy Calculator module & set address
  const calculator = await (
    await ethers.getContractFactory('MarginCalculator')
  ).deploy(oracle.address, addressbook.address)
  console.log('calculator: ' + calculator.address)
  try {
    await hre.run('verify:verify', {
      address: calculator.address,
      constructorArguments: [oracle.address, addressbook.address],
    })
    console.log('calculator verified')
  } catch (err: any) {
    if (err.message.includes('Reason: Already Verified')) {
      console.log('calculator contract already verified')
    }
  }
  await addressbook.setMarginCalculator(calculator.address)

  // deploy Controller & set address
  // deploy MarginVault library
  const vault = await (await ethers.getContractFactory('MarginVault')).deploy()

  try {
    await hre.run('verify:verify', {
      address: vault.address,
      constructorArguments: [],
    })
    console.log('vault verified')
  } catch (err: any) {
    if (err.message.includes('Reason: Already Verified')) {
      console.log('vault contract already verified')
    }
  }

  const controller = await (
    await ethers.getContractFactory('Controller', { libraries: { MarginVault: vault.address } })
  ).deploy()
  console.log('controller: ' + controller.address)

  try {
    await hre.run('verify:verify', {
      address: controller.address,
      constructorArguments: [],
    })
    console.log('controller verified')
  } catch (err: any) {
    if (err.message.includes('Reason: Already Verified')) {
      console.log('controller contract already verified')
    }
  }

  await addressbook.setController(controller.address)
  const controllerProxy = (await ethers.getContractAt('Controller', await addressbook.getController())) as Controller
  console.log(controllerProxy.address)

  try {
    await hre.run('verify:verify', {
      address: controllerProxy.address,
      constructorArguments: [],
    })
    console.log('controllerProxy verified')
  } catch (err: any) {
    if (err.message.includes('Reason: Already Verified')) {
      console.log('controllerProxy contract already verified')
    }
  }

  await controllerProxy.initialize(addressbook.address, await deployer.getAddress())
  await controllerProxy.setNakedCap(weth.address, utils.parseEther('5000'))
  await controllerProxy.setNakedCap(usdc.address, utils.parseEther('0.00001'))
  await controllerProxy.refreshConfiguration()

  // whitelist stuff

  // whitelist stuff

  await whitelist.whitelistCollateral(weth.address)
  await whitelist.whitelistCollateral(usdc.address)

  // whitelist products
  // normal calls
  await whitelist.whitelistProduct(weth.address, usdc.address, weth.address, false)
  // normal puts
  await whitelist.whitelistProduct(weth.address, usdc.address, usdc.address, true)
  // usd collateralised calls
  await whitelist.whitelistProduct(weth.address, usdc.address, usdc.address, false)
  // eth collateralised puts
  await whitelist.whitelistProduct(weth.address, usdc.address, weth.address, true)
  // whitelist vault type 0 collateral
  await whitelist.whitelistCoveredCollateral(weth.address, weth.address, false)
  await whitelist.whitelistCoveredCollateral(usdc.address, weth.address, true)
  // whitelist vault type 1 collateral
  await whitelist.whitelistNakedCollateral(usdc.address, weth.address, false)
  await whitelist.whitelistNakedCollateral(weth.address, weth.address, true)
  console.log('1111')
  // set product spot shock values
  // usd collateralised calls

  console.log(productSpotShockValue)
  console.log(scaleNum(0.5, 27))
  await calculator.setSpotShock(weth.address, usdc.address, usdc.address, false, productSpotShockValue)
  // usd collateralised puts
  await calculator.setSpotShock(weth.address, usdc.address, usdc.address, true, productSpotShockValue)
  // eth collateralised calls
  await calculator.setSpotShock(weth.address, usdc.address, weth.address, false, productSpotShockValue)
  console.log('2222')

  // set expiry to value values
  // usd collateralised calls
  await calculator.setUpperBoundValues(weth.address, usdc.address, usdc.address, false, timeToExpiry, expiryToValue)
  // usd collateralised puts
  await calculator.setUpperBoundValues(weth.address, usdc.address, usdc.address, true, timeToExpiry, expiryToValue)
  // eth collateralised calls
  await calculator.setUpperBoundValues(weth.address, usdc.address, weth.address, false, timeToExpiry, expiryToValue)

  await oracle.setStablePrice(usdc.address, '100000000')
  console.log('execution complete')
}
main()
  .then(() => process.exit())
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

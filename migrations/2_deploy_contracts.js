// import library
const MarginVault = artifacts.require('MarginVault')
// import contract
const OtokenFactory = artifacts.require('OtokenFactory')
const Otoken = artifacts.require('Otoken')
const Whitelist = artifacts.require('Whitelist')
const Oracle = artifacts.require('Oracle')
const MarginPool = artifacts.require('MarginPool')
const MarginCalculator = artifacts.require('MarginCalculator')
const AddressBook = artifacts.require('AddressBook')
const Controller = artifacts.require('Controller')
const MinimalForwarder = artifacts.require('MinimalForwarder')
const MarginRequirements = artifacts.require('MarginRequirements')
const OTCWrapper = artifacts.require('OTCWrapper')
const OwnedUpgradeabilityProxy = artifacts.require('OwnedUpgradeabilityProxy')

module.exports = async function(deployer, network, accounts) {
  const [deployerAddress] = accounts

  // deploy AddressBook & transfer ownership
  await deployer.deploy(AddressBook, {from: deployerAddress})
  const addressbook = await AddressBook.deployed()

  // deploy OtokenFactory & set address
  await deployer.deploy(OtokenFactory, addressbook.address, {from: deployerAddress})
  const otokenFactory = await OtokenFactory.deployed()
  await addressbook.setOtokenFactory(otokenFactory.address, {from: deployerAddress})

  // deploy Otoken implementation & set address
  await deployer.deploy(Otoken, {from: deployerAddress})
  const otokenImpl = await Otoken.deployed()
  await addressbook.setOtokenImpl(otokenImpl.address, {from: deployerAddress})

  // deploy Whitelist module & set address
  await deployer.deploy(Whitelist, addressbook.address, {from: deployerAddress})
  const whitelist = await Whitelist.deployed()
  await addressbook.setWhitelist(whitelist.address, {from: deployerAddress})

  // deploy Oracle module & set address
  await deployer.deploy(Oracle, {from: deployerAddress})
  const oracle = await Oracle.deployed()
  await addressbook.setOracle(oracle.address, {from: deployerAddress})

  // deploy MarginPool module & set address
  await deployer.deploy(MarginPool, addressbook.address, {from: deployerAddress})
  const pool = await MarginPool.deployed()
  await addressbook.setMarginPool(pool.address, {from: deployerAddress})

  // deploy Calculator module & set address
  await deployer.deploy(MarginCalculator, oracle.address, addressbook.address, {from: deployerAddress})
  const calculator = await MarginCalculator.deployed()
  await addressbook.setMarginCalculator(calculator.address, {from: deployerAddress})

  // deploy Controller & set address
  // deploy MarginVault library
  await deployer.deploy(MarginVault, {from: deployerAddress})
  await deployer.link(MarginVault, Controller)
  await deployer.deploy(Controller, {from: deployerAddress})
  const controller = await Controller.deployed()
  await addressbook.setController(controller.address, {from: deployerAddress})

  // deploy Margin Requirements 
  await deployer.deploy(MarginRequirements, addressbook.address, {from: deployerAddress})
  const requirements = await MarginRequirements.deployed()
  await addressbook.setMarginRequirements(requirements.address, {from: deployerAddress})

  // deploy Minimal Forwarder
  await deployer.deploy(MinimalForwarder, {from: deployerAddress})
  const forwarder = await MinimalForwarder.deployed()

  // deploy OTC wrapper
  const addressUSDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // ETH Mainnet USDC address
  const fillDeadline = 15*60 // 15 minutes
  const beneficiary = "0xF8368119Bb1073Cf01B841848725d81b542A4c19" // Temporary
  
  const otcWrapperImplementation = await OTCWrapper.new(forwarder.address, addressUSDC)
  const ownedUpgradeabilityProxy = await OwnedUpgradeabilityProxy.new()

  await ownedUpgradeabilityProxy.upgradeTo(otcWrapperImplementation.address)
  
  const otcWrapperProxy = await OTCWrapper.at(ownedUpgradeabilityProxy.address)

  await otcWrapperProxy.initialize(addressbook.address, beneficiary, fillDeadline)

  await addressbook.setOTCWrapper(otcWrapperProxy.address, {from: deployerAddress})
  
  console.log("OTC Wrapper Implementation at", otcWrapperImplementation.address)

  console.log("OTC Wrapper Proxy at", otcWrapperProxy.address)
}

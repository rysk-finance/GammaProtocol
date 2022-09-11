import hre, { ethers, run} from "hardhat"
import { BigNumber, BigNumberish, utils } from "ethers"
import {AddressBook} from "../types/AddressBook"
import {Whitelist} from "../types/Whitelist"
import {Oracle} from "../types/Oracle"
import {MarginCalculator} from "../types/MarginCalculator"
import {Controller} from "../types/Controller"

// arbitrum rinkeby testnet addresses
const usdcAddress = "0x33a010E74A354bd784a62cca3A4047C1A84Ceeab"
const wethAddress = "0xFCfbfcC11d12bCf816415794E5dc1BBcc5304e01"
const chainlinkOracleAddress = "0x5f0423B1a6935dc5596e7A24d98532b67A0AeFd8"

// arbitrum mainnet addresses
// const usdcAddress = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8"
// const wethAddress = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
// const chainlinkOracleAddress = "0x639fe6ab55c921f74e7fac1ee960c0b6293ba612"

const productSpotShockValue = utils.parseUnits("0.7", 27)
// array of time to expiry
const day = 60 * 60 * 24
const timeToExpiry = [day * 7, day * 14, day * 28, day * 42, day * 56, day * 70, day * 84]
// array of upper bound value correspond to time to expiry
const expiryToValue = [
	utils.parseUnits("0.1946", 27),
	utils.parseUnits("0.2738", 27),
	utils.parseUnits("0.3818", 27),
	utils.parseUnits("0.4600", 27),
	utils.parseUnits("0.5220", 27),
	utils.parseUnits("0.5735", 27),
	utils.parseUnits("0.6171", 27)
]

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("deployer: " + await deployer.getAddress())
	const usdc = await ethers.getContractAt("MockERC20", usdcAddress)
	const weth = await ethers.getContractAt("MockERC20", wethAddress)

    // // deploy AddressBook & transfer ownership
    const addressbook = await (await ethers.getContractFactory("AddressBook")).deploy()
    console.log("addressbook: " + addressbook.address)

	try {
		await run("verify:verify", {
			address: addressbook.address,
			constructorArguments: []
		})
		console.log("addressbook verified")
	} catch (err: any) {
		if (err.message.includes("Reason: Already Verified")) {
			console.log("addressbook contract already verified")
		}
		console.log(err)
	}
    // // deploy OtokenFactory & set address
    const otokenFactory = await(await ethers.getContractFactory("OtokenFactory")).deploy(addressbook.address)
	console.log("otokenFactory: " + otokenFactory.address)

	try {
		await run("verify:verify", {
			address: otokenFactory.address,
			constructorArguments: [addressbook.address]
		})
		console.log("otokenFactory verified")
	} catch (err: any) {
		if (err.message.includes("Reason: Already Verified")) {
			console.log("otokenFactory contract already verified")
		}
		console.log(err)
	}

    await addressbook.setOtokenFactory(otokenFactory.address)

    // // deploy Otoken implementation & set address
    const otoken = await (await ethers.getContractFactory("Otoken")).deploy()
	console.log("otoken: " + otoken.address)

	try {
		await run("verify:verify", {
			address: otoken.address,
			constructorArguments: []
		})
		console.log("otoken verified")
	} catch (err: any) {
		if (err.message.includes("Reason: Already Verified")) {
			console.log("otoken contract already verified")
		}
		console.log(err)
	}

    await addressbook.setOtokenImpl(otoken.address)

    // // deploy Whitelist module & set address
    const whitelist = await (await ethers.getContractFactory("Whitelist")).deploy(addressbook.address)
    console.log("whitelist: " + whitelist.address)

	try {
		await run("verify:verify", {
			address: whitelist.address,
			constructorArguments: [addressbook.address]
		})
		console.log("whitelist verified")
	} catch (err: any) {
		if (err.message.includes("Reason: Already Verified")) {
			console.log("whitelist contract already verified")
		}
		console.log(err)
	}
	
	await addressbook.setWhitelist(whitelist.address)

    // // deploy Oracle module & set address
    const oracle = await (await ethers.getContractFactory("Oracle")).deploy()
    console.log("oracle: " + oracle.address)

	try {
		await run("verify:verify", {
			address: oracle.address,
			constructorArguments: []
		})
		console.log("oracle verified")
	} catch (err: any) {
		if (err.message.includes("Reason: Already Verified")) {
			console.log("oracle contract already verified")
		}
	}

    await addressbook.setOracle(oracle.address)

    // // deploy MarginPool module & set address
    const pool = await (await ethers.getContractFactory("MarginPool")).deploy(addressbook.address)
	console.log("pool: " + pool.address)

	try {
		await run("verify:verify", {
			address: pool.address,
			constructorArguments: [addressbook.address]
		})
		console.log("pool verified")
	} catch (err: any) {
		if (err.message.includes("Reason: Already Verified")) {
			console.log("pool contract already verified")
		}
	}

	await addressbook.setMarginPool(pool.address)

    // deploy Calculator module & set address
    const calculator = await (await ethers.getContractFactory("MarginCalculator")).deploy(oracle.address, addressbook.address)
    console.log("calculator: " + calculator.address)
	try {
		await run("verify:verify", {
			address: calculator.address,
			constructorArguments: [oracle.address, addressbook.address]
		})
		console.log("calculator verified")
	} catch (err: any) {
		if (err.message.includes("Reason: Already Verified")) {
			console.log("calculator contract already verified")
		}
	}
	await addressbook.setMarginCalculator(calculator.address)

    // deploy Controller & set address
    // deploy MarginVault library
    const vault = await (await ethers.getContractFactory("MarginVault")).deploy()

	try {
		await run("verify:verify", {
			address: vault.address,
			constructorArguments: []
		})
		console.log("vault verified")
	} catch (err: any) {
		if (err.message.includes("Reason: Already Verified")) {
			console.log("vault contract already verified")
		}
	}

    const controller = await (await ethers.getContractFactory("Controller", {libraries:{MarginVault: vault.address}})).deploy()
    console.log("controller: " + controller.address)

	try {
		await run("verify:verify", {
			address: controller.address,
			constructorArguments: []
		})
		console.log("controller verified")
	} catch (err: any) {
		if (err.message.includes("Reason: Already Verified")) {
			console.log("controller contract already verified")
		}
	}

	await addressbook.setController(controller.address)
	const controllerProxy = await ethers.getContractAt("Controller", (await addressbook.getController())) as Controller
	console.log("controllerProxy: " + controllerProxy.address)

	try {
		await run("verify:verify", {
			address: controllerProxy.address,
			constructorArguments: []
		})
		console.log("controllerProxy verified")
	} catch (err: any) {
		if (err.message.includes("Reason: Already Verified")) {
			console.log("controllerProxy contract already verified")
		}
		console.log(err)
	}

    await controllerProxy.initialize(addressbook.address, await deployer.getAddress())
	await controllerProxy.setNakedCap(weth.address, utils.parseEther('5000'))
	await controllerProxy.setNakedCap(usdc.address, utils.parseEther('0.00001'))
    await controllerProxy.refreshConfiguration()
    
    // whitelist stuff

    await whitelist.whitelistCollateral(weth.address)
	await whitelist.whitelistCollateral(usdc.address)

    // whitelist products
	// normal calls
	await whitelist.whitelistProduct(
		weth.address,
		usdc.address,
		weth.address,
		false
	)
	// normal puts
	await whitelist.whitelistProduct(
		weth.address,
		usdc.address,
		usdc.address,
		true
	)
	// usd collateralised calls
	await whitelist.whitelistProduct(
		weth.address,
		usdc.address,
		usdc.address,
		false
	)
	// eth collateralised puts
	await whitelist.whitelistProduct(
		weth.address,
		usdc.address,
		weth.address,
		true
	)
	// whitelist vault type 0 collateral
	await whitelist.whitelistCoveredCollateral(weth.address, weth.address, false)
	await whitelist.whitelistCoveredCollateral(usdc.address, weth.address, true)
	// whitelist vault type 1 collateral
	await whitelist.whitelistNakedCollateral(usdc.address, weth.address, false)
	await whitelist.whitelistNakedCollateral(weth.address, weth.address, true)

    // set product spot shock values
	// usd collateralised calls
	await calculator.setSpotShock(
		weth.address,
		usdc.address,
		usdc.address,
		false,
		productSpotShockValue
	)
	// usd collateralised puts
	await calculator.setSpotShock(
		weth.address,
		usdc.address,
		usdc.address,
		true,
		productSpotShockValue
	)
	// eth collateralised calls
	await calculator.setSpotShock(
		weth.address,
		usdc.address,
		weth.address,
		false,
		productSpotShockValue
	)
	// set expiry to value values
	// usd collateralised calls
	await calculator.setUpperBoundValues(
		weth.address,
		usdc.address,
		usdc.address,
		false,
		timeToExpiry,
		expiryToValue
	)
	// usd collateralised puts
	await calculator.setUpperBoundValues(
		weth.address,
		usdc.address,
		usdc.address,
		true,
		timeToExpiry,
		expiryToValue
	)
	// eth collateralised calls
	await calculator.setUpperBoundValues(
		weth.address,
		usdc.address,
		weth.address,
		false,
		timeToExpiry,
		expiryToValue
	)

	await oracle.setStablePrice(usdc.address, "100000000")
	console.log("execution complete")
	console.log("addressbook: " + addressbook.address)
	console.log("otokenFactory: " + otokenFactory.address)
	console.log("otoken: " + otoken.address)
	console.log("whitelist: " + whitelist.address)
	console.log("oracle: " + oracle.address)
	console.log("pool: " + pool.address)
	console.log("calculator: " + calculator.address)
	console.log("controller: " + controller.address)
	console.log("controllerProxy: " + controllerProxy.address)
	
}
main()
    .then(() => process.exit())
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
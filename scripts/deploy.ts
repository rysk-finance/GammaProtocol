import hre, { ethers, run} from "hardhat"
import { BigNumber, BigNumberish, utils } from "ethers"
import {AddressBook} from "../types/AddressBook"
import {Whitelist} from "../types/Whitelist"
import {Oracle} from "../types/Oracle"
import {MarginCalculator} from "../types/MarginCalculator"
import {Controller} from "../types/Controller"

// arbitrum rinkeby testnet addresses
// const usdcAddress = "0x33a010E74A354bd784a62cca3A4047C1A84Ceeab"
// const wethAddress = "0xFCfbfcC11d12bCf816415794E5dc1BBcc5304e01"


// arbitrum mainnet addresses
const usdcAddress = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8"
const wethAddress = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
const multisig = "0xFBdE2e477Ed031f54ed5Ad52f35eE43CD82cF2A6"

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

const productSpotShockValue = utils.parseUnits("0.7", 27)

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
		} else {
			console.log(err)
		}
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
		} else {
			console.log(err)
		}
	}

    await addressbook.setOtokenFactory(otokenFactory.address, {gasLimit: BigNumber.from("500000000")})

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

    await addressbook.setOtokenImpl(otoken.address, {gasLimit: BigNumber.from("500000000")})

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
		} else {
			console.log(err)
		}
	}
	
	await addressbook.setWhitelist(whitelist.address, {gasLimit: BigNumber.from("500000000")})

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
		} else {
			console.log(err)
		}
	}

    await addressbook.setOracle(oracle.address, {gasLimit: BigNumber.from("500000000")})

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
		} else {
			console.log(err)
		}
	}

	await addressbook.setMarginPool(pool.address, {gasLimit: BigNumber.from("500000000")})

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
		} else {
			console.log(err)
		}
	}
	await addressbook.setMarginCalculator(calculator.address, {gasLimit: BigNumber.from("500000000")})

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
		} else {
			console.log(err)
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
		} else {
			console.log(err)
		}
	}

	await addressbook.setController(controller.address, {gasLimit: BigNumber.from("500000000")})
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
	await controller.initialize(addressbook.address, multisig , {gasLimit: BigNumber.from("500000000")})
    await controllerProxy.initialize(addressbook.address, multisig, {gasLimit: BigNumber.from("500000000")})
	await controllerProxy.setNakedCap(weth.address, utils.parseEther('5000'), {gasLimit: BigNumber.from("500000000")})
	await controllerProxy.setNakedCap(usdc.address, utils.parseUnits("10000000", 6), {gasLimit: BigNumber.from("500000000")})
    await controllerProxy.refreshConfiguration({gasLimit: BigNumber.from("500000000")})
    
    // whitelist stuff

    await whitelist.whitelistCollateral(weth.address, {gasLimit: BigNumber.from("500000000")})
	await whitelist.whitelistCollateral(usdc.address, {gasLimit: BigNumber.from("500000000")})

    // whitelist products
	// normal calls
	await whitelist.whitelistProduct(
		weth.address,
		usdc.address,
		weth.address,
		false, {gasLimit: BigNumber.from("500000000")}
	)
	// normal puts
	await whitelist.whitelistProduct(
		weth.address,
		usdc.address,
		usdc.address,
		true, {gasLimit: BigNumber.from("500000000")}
	)
	// usd collateralised calls
	await whitelist.whitelistProduct(
		weth.address,
		usdc.address,
		usdc.address,
		false, {gasLimit: BigNumber.from("500000000")}
	)
	// eth collateralised puts
	await whitelist.whitelistProduct(
		weth.address,
		usdc.address,
		weth.address,
		true, {gasLimit: BigNumber.from("500000000")}
	)
	// whitelist vault type 0 collateral
	await whitelist.whitelistCoveredCollateral(weth.address, weth.address, false, {gasLimit: BigNumber.from("500000000")})
	await whitelist.whitelistCoveredCollateral(usdc.address, weth.address, true, {gasLimit: BigNumber.from("500000000")})
	// whitelist vault type 1 collateral
	await whitelist.whitelistNakedCollateral(usdc.address, weth.address, false, {gasLimit: BigNumber.from("500000000")})
	await whitelist.whitelistNakedCollateral(weth.address, weth.address, true, {gasLimit: BigNumber.from("500000000")})

    // set product spot shock values
	// usd collateralised calls
	await calculator.setSpotShock(
		weth.address,
		usdc.address,
		usdc.address,
		false,
		productSpotShockValue, {gasLimit: BigNumber.from("500000000")}
	)
	// usd collateralised puts
	await calculator.setSpotShock(
		weth.address,
		usdc.address,
		usdc.address,
		true,
		productSpotShockValue, {gasLimit: BigNumber.from("500000000")}
	)
	// eth collateralised calls
	await calculator.setSpotShock(
		weth.address,
		usdc.address,
		weth.address,
		false,
		productSpotShockValue, {gasLimit: BigNumber.from("500000000")}
	)
	// eth collateralised puts
	await calculator.setSpotShock(
		weth.address,
		usdc.address,
		weth.address,
		true,
		productSpotShockValue, {gasLimit: BigNumber.from("500000000")}
	)
	// set expiry to value values
	// usd collateralised calls
	await calculator.setUpperBoundValues(
		weth.address,
		usdc.address,
		usdc.address,
		false,
		timeToExpiry,
		expiryToValue, {gasLimit: BigNumber.from("500000000")}
	)
	// usd collateralised puts
	await calculator.setUpperBoundValues(
		weth.address,
		usdc.address,
		usdc.address,
		true,
		timeToExpiry,
		expiryToValue, {gasLimit: BigNumber.from("500000000")}
	)
	// eth collateralised calls
	await calculator.setUpperBoundValues(
		weth.address,
		usdc.address,
		weth.address,
		false,
		timeToExpiry,
		expiryToValue, {gasLimit: BigNumber.from("500000000")}
	)
	// eth collateralised puts
	await calculator.setUpperBoundValues(
		weth.address,
		usdc.address,
		weth.address,
		true,
		timeToExpiry,
		expiryToValue, {gasLimit: BigNumber.from("500000000")}
	)
	await oracle.setStablePrice(usdc.address, "100000000", {gasLimit: BigNumber.from("500000000")})

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

	await addressbook.transferOwnership(multisig, {gasLimit: BigNumber.from("500000000")})
	await whitelist.transferOwnership(multisig, {gasLimit: BigNumber.from("500000000")})
	await pool.transferOwnership(multisig, {gasLimit: BigNumber.from("500000000")})
	await calculator.transferOwnership(multisig, {gasLimit: BigNumber.from("500000000")})
	await controller.transferOwnership(multisig, {gasLimit: BigNumber.from("500000000")})
	await controllerProxy.transferOwnership(multisig, {gasLimit: BigNumber.from("500000000")})
	console.log("ownership transferred")
}
main()
    .then(() => process.exit())
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
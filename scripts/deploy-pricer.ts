import {ethers} from "hardhat";
import {
    createScaledNumber as scaleNum,
  } from '../test/utils'
import { BigNumber, BigNumberish, utils } from "ethers"
import {Oracle} from "../types/Oracle"
import {Whitelist} from "../types/Whitelist"
import {MarginCalculator} from "../types/MarginCalculator"
import {Controller} from "../types/Controller"

const lockingPeriod = 60 * 10
const disputePeriod = 60 * 20
const chainlinkOracle = "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612"
const bot = "0x2ce708d31669d3a53f07786d6e06659891100d3f"
const weth = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
const usdc = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
const sequencerUptimeFeed = "0xfdb631f5ee196f0ed6faa767959853a9f217697d"

const productSpotShockValue = scaleNum(1, 27)
const day = 60 * 60 * 24
        const timeToExpiry = [
            day * 7, 
            day * 14,
            day * 28, 
            day * 42, 
            day * 56, 
            day * 70,
            day * 84
        ]

        const expiryToValueCalls = [
            scaleNum(0.137310398921181, 27),
            scaleNum(0.21532271007278914, 27),
            scaleNum(0.28537036027751395, 27),
            scaleNum(0.3483113205978359, 27),
            scaleNum(0.4214755691406809, 27),
            scaleNum(0.49055405840298094, 27),
            scaleNum(0.5301302667777277, 27)
        ]

        const expiryToValuePuts = [
            scaleNum(0.16097528948543374, 27),
            scaleNum(0.23027824327552782, 27),
            scaleNum(0.3056523951032439, 27),
            scaleNum(0.38082167009044565, 27),
            scaleNum(0.4539548883445394, 27),
            scaleNum(0.5238145515841939, 27),
            scaleNum(0.5678502236865992, 27)
        ]

async function main() {
    
    const [deployer] = await ethers.getSigners();
    console.log("deployer: " + await deployer.getAddress())

    const oracle = await ethers.getContractAt("Oracle", "0xBA1880CFFE38DD13771CB03De896460baf7dA1E7") as Oracle
    const whitelist = await ethers.getContractAt("Whitelist", "0xf6651d140aeee442e91a6bae418c4993d0190370") as Whitelist
	const calculator = await ethers.getContractAt("MarginCalculator", "0xcD270e755C2653e806e16dD3f78E16C89B7a1c9e") as MarginCalculator
	const controller = await ethers.getContractAt("Controller", "0x11a602a5F5D823c103bb8b7184e22391Aae5F4C2") as Controller
    // deploy pricer
    const pricer = await(await ethers.getContractFactory("L2ChainLinkPricer")).deploy(bot, weth, chainlinkOracle, oracle.address, sequencerUptimeFeed)
//     console.log("pricer: " + pricer.address)
//     await oracle.setAssetPricer(weth, pricer.address)
//     await oracle.setLockingPeriod(pricer.address, lockingPeriod)
//     await oracle.setDisputePeriod(pricer.address, disputePeriod)

//     await controller.setNakedCap(weth, utils.parseEther('1000000'))
// 	await controller.setNakedCap(usdc, utils.parseEther('1000000'))
//     await controller.refreshConfiguration()

//      // whitelist stuff

//     await whitelist.whitelistCollateral(weth)
// 	await whitelist.whitelistCollateral(usdc)

// // whitelist products
// 	// normal calls
// 	await whitelist.whitelistProduct(
// 		weth,
// 		usdc,
// 		weth,
// 		false
// 	)
// 	// normal puts
// 	await whitelist.whitelistProduct(
// 		weth,
// 		usdc,
// 		usdc,
// 		true
// 	)
// 	// usd collateralised calls
// 	await whitelist.whitelistProduct(
// 		weth,
// 		usdc,
// 		usdc,
// 		false
// 	)
// 	// eth collateralised puts
// 	await whitelist.whitelistProduct(
// 		weth,
// 		usdc,
// 		weth,
// 		true
// 	)
// 	// whitelist vault type 0 collateral
// 	await whitelist.whitelistCoveredCollateral(weth, weth, false)
// 	await whitelist.whitelistCoveredCollateral(usdc, weth, true)
// 	// whitelist vault type 1 collateral
// 	await whitelist.whitelistNakedCollateral(usdc, weth, false)
// 	await whitelist.whitelistNakedCollateral(weth, weth, true)

//     // set product spot shock values
// 	// usd collateralised calls
// 	await calculator.setSpotShock(
// 		weth,
// 		usdc,
// 		usdc,
// 		false,
// 		productSpotShockValue
// 	)
// 	// usd collateralised puts
// 	await calculator.setSpotShock(
// 		weth,
// 		usdc,
// 		usdc,
// 		true,
// 		productSpotShockValue
// 	)
// 	// eth collateralised calls
// 	await calculator.setSpotShock(
// 		weth,
// 		usdc,
// 		weth,
// 		false,
// 		productSpotShockValue
// 	)
// 	// set expiry to value values
// 	// usd collateralised calls
// 	await calculator.setUpperBoundValues(
// 		weth,
// 		usdc,
// 		usdc,
// 		false,
// 		timeToExpiry,
// 		expiryToValue
// 	)
// 	// usd collateralised puts
// 	await calculator.setUpperBoundValues(
// 		weth,
// 		usdc,
// 		usdc,
// 		true,
// 		timeToExpiry,
// 		expiryToValue
// 	)
// 	// eth collateralised calls
// 	await calculator.setUpperBoundValues(
// 		weth,
// 		usdc,
// 		weth,
// 		false,
// 		timeToExpiry,
// 		expiryToValue
// 	)

// 	await oracle.setStablePrice(usdc, "100000000")
	console.log("execution complete")
}
main()
    .then(() => process.exit())
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


import hre, {ethers, run} from "hardhat";
import {
    createScaledNumber as scaleNum,
  } from '../test/utils'
import { BigNumber, BigNumberish, utils } from "ethers"
import {Oracle} from "../types/Oracle"

const lockingPeriod = 60 * 10
const disputePeriod = 60 * 20
const chainlinkOracle = "0x5f0423B1a6935dc5596e7A24d98532b67A0AeFd8"
const bot = "0x282f13b62b4341801210657e3aa4ee1df69f4083"
const weth = "0xFCfbfcC11d12bCf816415794E5dc1BBcc5304e01"
const oracleAddress = "0xd9BBa5CAcE81ebE3db3FD7E6d91Ae92d5f19BAb8"

// arbitrum mainnet addresses
// const chainlinkOracleAddress = "0x639fe6ab55c921f74e7fac1ee960c0b6293ba612"
// const bot = "0x2ce708d31669d3a53f07786d6e06659891100d3f"
// const weth = "0xFCfbfcC11d12bCf816415794E5dc1BBcc5304e01"
// const oracle = ""
async function main() {
    
    const [deployer] = await ethers.getSigners();
    console.log("deployer: " + await deployer.getAddress())
    const oracle = await ethers.getContractAt("Oracle", oracleAddress) as Oracle
    // deploy pricer
    const pricer = await(await ethers.getContractFactory("ChainLinkPricer")).deploy(bot, weth, chainlinkOracle, oracle.address)
    console.log("pricer: " + pricer.address)

    try {
		await run("verify:verify", {
			address: pricer.address,
			constructorArguments: [bot, weth, chainlinkOracle, oracleAddress]
		})
		console.log("pricer verified")
	} catch (err: any) {
		if (err.message.includes("Reason: Already Verified")) {
			console.log("pricer contract already verified")
		} else {
            console.log(err)
        }
	}

    await oracle.setAssetPricer(weth, pricer.address)
    await oracle.setLockingPeriod(pricer.address, lockingPeriod)
    await oracle.setDisputePeriod(pricer.address, disputePeriod)
    console.log("pricer: " + pricer.address)
	console.log("execution complete")
}
main()
    .then(() => process.exit())
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


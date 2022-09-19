import hre, {ethers, run} from "hardhat";
import {
    createScaledNumber as scaleNum,
  } from '../test/utils'
import { BigNumber, BigNumberish, utils } from "ethers"
import {Oracle} from "../types/Oracle"

const lockingPeriod = 60 * 10
const disputePeriod = 60 * 20
const disputePeriodHigh = 60 * 60 * 24 * 30
const weth = "0xFCfbfcC11d12bCf816415794E5dc1BBcc5304e01"
const oracleAddress = "0xe4d64aed5e76bCcE2C255f3c819f4C3817D42f19"
const pricerAddress = "0x3c1b4C64010b10C66fc41e548C4C9A334DE2D5a5"
const expiry = 1663142400
const price = utils.parseUnits("1611", 8)

// arbitrum mainnet addresses
// const weth = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
// const oracleAddress = "0xBA1880CFFE38DD13771CB03De896460baf7dA1E7"
// const multisig = "0xFBdE2e477Ed031f54ed5Ad52f35eE43CD82cF2A6"


async function main() {
    
    const [deployer] = await ethers.getSigners();
    console.log("deployer: " + await deployer.getAddress())
    const oracle = await ethers.getContractAt("Oracle", oracleAddress) as Oracle
    await oracle.setDisputePeriod(pricerAddress, disputePeriodHigh, {gasLimit: BigNumber.from("500000000")})
    await oracle.setDisputer(deployer.address)
    await oracle.disputeExpiryPrice(weth, expiry, price )
    await oracle.setDisputePeriod(pricerAddress, disputePeriod, {gasLimit: BigNumber.from("500000000")})
    console.log("vault rescued")

}
main()
    .then(() => process.exit())
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


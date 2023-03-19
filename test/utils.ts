import { MockERC20Instance } from '../build/types/truffle-types'
import BigNumber from 'bignumber.js'
import { BigNumberish, Contract, Signature, Wallet } from 'ethers'
import { splitSignature } from 'ethers/lib/utils'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const util = require('@0x/protocol-utils')
const ethSigUtil = require('eth-sig-util')
const { ethers } = require('ethers/lib/utils')

export type vault = {
  shortAmounts: (BigNumber | string | number)[]
  longAmounts: (BigNumber | string | number)[]
  collateralAmounts: (BigNumber | string | number)[]
  shortOtokens: string[]
  longOtokens: string[]
  collateralAssets: string[]
}

export type permit = {
  acct: string
  amount: (BigNumber | string | number)
  deadline: (BigNumber | string | number)
  v: string
  r: string
  s: string
}

/**
 * Return a valid expiry timestamp that's today + # days, 0800 UTC.
 * @param now
 * @param days
 */
export const createValidExpiry = (now: number, days: number) => {
  const multiplier = (now - 28800) / 86400
  return (Number(multiplier.toFixed(0)) + 1) * 86400 + days * 86400 + 28800
}

/**
 * Create a vault for testing
 * @param shortOtoken
 * @param longOtoken
 * @param collateralAsset
 * @param shortAmount
 * @param longAmount
 * @param collateralAmount
 */
export const createVault = (
  shortOtoken: string | undefined,
  longOtoken: string | undefined,
  collateralAsset: string | undefined,
  shortAmount: string | BigNumber | number | undefined,
  longAmount: string | BigNumber | number | undefined,
  collateralAmount: string | BigNumber | number | undefined,
): vault => {
  return {
    shortOtokens: shortOtoken ? [shortOtoken] : [],
    longOtokens: longOtoken ? [longOtoken] : [],
    collateralAssets: collateralAsset ? [collateralAsset] : [],
    shortAmounts: shortAmount !== undefined ? [shortAmount] : [],
    longAmounts: longAmount !== undefined ? [longAmount] : [],
    collateralAmounts: collateralAmount !== undefined ? [collateralAmount] : [],
  }
}

export const createTokenAmount = (num: number | BigNumber, decimals = 8) => {
  const amount = new BigNumber(num).times(new BigNumber(10).pow(decimals))
  return amount.integerValue().toString()
}

/**
 * Create a number string that scales numbers to 1e8
 * @param num
 */
export const createScaledNumber = (num: number, decimals = 8): string => {
  return new BigNumber(num).times(new BigNumber(10).pow(decimals)).toString()
}

/**
 * Create a number string that scales numbers to 1e8
 * @param num
 */
export const createScaledBigNumber = (num: number, decimals = 8): BigNumber => {
  return new BigNumber(num).times(new BigNumber(10).pow(decimals))
}

export const underlyingPriceToCtokenPrice = async (
  underlyingPrice: BigNumber,
  exchangeRate: BigNumber,
  underlying: MockERC20Instance,
) => {
  const underlyingDecimals = new BigNumber(await underlying.decimals())
  const cTokenDecimals = new BigNumber(8)
  return exchangeRate
    .times(underlyingPrice)
    .times(new BigNumber(10).exponentiatedBy(cTokenDecimals))
    .div(new BigNumber(10).exponentiatedBy(underlyingDecimals.plus(new BigNumber(18))))
    .integerValue(BigNumber.ROUND_DOWN)
}

export const underlyingPriceToYTokenPrice = async (
  underlyingPrice: BigNumber,
  pricePerShare: BigNumber,
  underlying: MockERC20Instance,
) => {
  const underlyingDecimals = new BigNumber(await underlying.decimals())
  return pricePerShare
    .times(underlyingPrice)
    .div(new BigNumber(10).exponentiatedBy(underlyingDecimals))
    .integerValue(BigNumber.ROUND_DOWN)
}

/**
 * @param {number} num number to scale
 * @param {number} fromDecimal the decimals the original number has
 * @param {number} toDecimal the decimals the target number has
 * @return {BigNumber}
 */
export const changeAmountScaled = (num: number | string, fromDecimal: number, toDecimal: number) => {
  const numBN = new BigNumber(num)
  if (toDecimal === fromDecimal) {
    return numBN
  } else if (toDecimal >= fromDecimal) {
    return numBN.times(new BigNumber(10).pow(toDecimal - fromDecimal))
  } else {
    return numBN.div(new BigNumber(10).pow(fromDecimal - toDecimal)).integerValue()
  }
}

export const createOrder = (
  maker: string,
  makerToken: string,
  takerToken: string,
  makerAmount: BigNumber,
  takerAmount: BigNumber,
  chainId: number,
) => {
  const expiry = (Date.now() / 1000 + 240).toFixed(0)
  const salt = (Math.random() * 1000000000000000000).toFixed(0)
  const order = new util.LimitOrder({
    makerToken: makerToken,
    takerToken: takerToken,
    makerAmount: makerAmount.toString(),
    takerAmount: takerAmount.toString(),
    takerTokenFeeAmount: '0',
    maker: maker,
    taker: '0x0000000000000000000000000000000000000000',
    sender: '0x0000000000000000000000000000000000000000',
    feeRecipient: '0x1000000000000000000000000000000000000011',
    pool: '0x0000000000000000000000000000000000000000000000000000000000000000',
    expiry: expiry.toString(),
    salt: salt,
    chainId: chainId,
  })
  return order
}

export const signOrder = async (signer: any, order: any, key: any) => {
  const signature = await order.getSignatureWithKey(key, util.SignatureType.EIP712)
  // eslint-disable-next-line no-param-reassign
  order.signature = signature
  return order
}

export const expectedLiquidationPrice = (
  collateral: number | string,
  debt: number,
  cashValue: number,
  spotPrice: number,
  oracleDeviation: number,
  auctionStartingTime: number,
  currentBlockTime: number,
  isPut: boolean,
  collateralDecimals: number,
  collateralAsset: string,
  underlyingAsset: string,
) => {
  const endingPrice = new BigNumber(collateral).dividedBy(debt)
  const auctionElapsedTime = currentBlockTime - auctionStartingTime

  if (auctionElapsedTime > 3600) {
    // return Math.floor(endingPrice)
    return endingPrice.multipliedBy(10 ** collateralDecimals).toNumber()
  }

  return endingPrice.multipliedBy(10 ** collateralDecimals).toNumber()
}

export const calcRelativeDiff = (expected: BigNumber, actual: BigNumber): BigNumber => {
  return actual.minus(expected).abs()
}

export async function generateWallet(asset: Contract, amount: BigNumber, owner: SignerWithAddress) {
  let provider = new ethers.providers.JsonRpcProvider(process.env.TEST_URI)
  let signer = new ethers.Wallet('0ce495bd7bab5341ae5a7ac195173fba1aa56f6561e35e1fec6176e2519ab8da', provider)

  await ethers.provider.request({
    // provider change to ethers
    method: 'hardhat_impersonateAccount',
    params: [signer.address],
  })

  await asset.connect(owner).transfer(signer.address, amount)
  //await asset.transfer(signer.address, amount, { from: owner });

  // Create a transaction object
  let tx = {
    to: signer.address,
    // Convert currency unit from ether to wei
    value: ethers.utils.parseEther('10'),
  }

  await owner.sendTransaction(tx)

  return signer
}

export async function getDAIPermitSignature(
  wallet: Wallet,
  token: Contract,
  spender: string,
  expiry: BigNumberish,
  allowed: boolean,
  permitConfig?: {
    nonce: BigNumberish
    name: string
    chainId: number
    version: string
  },
): Promise<Signature> {
  const [nonce, name, version, chainId] = await Promise.all([
    permitConfig?.nonce ?? '0',
    permitConfig?.name ?? 'Dai Stablecoin',
    permitConfig?.version ?? '1',
    permitConfig?.chainId ?? '1',
  ])

  return splitSignature(
    await wallet._signTypedData(
      {
        name,
        version,
        chainId,
        verifyingContract: token.address,
      },
      {
        Permit: [
          {
            name: 'holder',
            type: 'address',
          },
          {
            name: 'spender',
            type: 'address',
          },
          {
            name: 'nonce',
            type: 'uint256',
          },
          {
            name: 'expiry',
            type: 'uint256',
          },
          {
            name: 'allowed',
            type: 'bool',
          },
        ],
      },
      {
        holder: wallet.address,
        spender,
        nonce,
        expiry,
        allowed,
      },
    ),
  )
}

#!/bin/bash
source script/.env
export BASESCAN_API_KEY=DYR5VWFHGC62MIJ9RZSX6V34N16H77B3QW
echo "guh"
forge script script/GammaProtocolBaseTestnet.s.sol:GammaDeploymentScript --sig "run()" --fork-url https://base-sepolia.g.alchemy.com/v2/sPLbeK1fKZsqDemsivHO1d3AUlfZMBl- --broadcast -vv --sender 0x34973347D332F97b57e5f0953Ad5864Ba8E579DD --verify
#!/bin/bash
source .env
forge script script/deployNewPricer.s.sol:DeployNewPricer --sig "run()" --fork-url https://base-sepolia.g.alchemy.com/v2/sPLbeK1fKZsqDemsivHO1d3AUlfZMBl- --broadcast -vv --sender 0x34973347D332F97b57e5f0953Ad5864Ba8E579DD --verify
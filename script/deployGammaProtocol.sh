#!/bin/bash
source .env
forge script script/GammaProtocol.s.sol:GammaDeploymentScript --sig "run()" --fork-url https://nameless-skilled-butterfly.blast-sepolia.quiknode.pro/0da6ab00e3717ee2ecd83e7881fc5a8c88ac6daa/ --broadcast -vv --sender 0x34973347D332F97b57e5f0953Ad5864Ba8E579DD --verify
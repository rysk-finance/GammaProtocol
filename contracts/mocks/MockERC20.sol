// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.6.10;

import {ERC20PermitUpgradeable} from "../packages/oz/upgradeability/erc20-permit/ERC20PermitUpgradeable.sol";

contract MockERC20 is ERC20PermitUpgradeable {
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    ) public {
        __ERC20_init_unchained(_name, _symbol);
        _setupDecimals(_decimals);

        string memory tokenName = "ETHUSDC/1597511955/200P/USDC";
        string memory tokenSymbol = "oETHUSDCP";
        __ERC20Permit_init(tokenName);
    }

    function mint(address account, uint256 amount) public {
        _mint(account, amount);
    }

    function getChainId() external view returns (uint256 chainId) {
        this; // silence state mutability warning without generating bytecode - see https://github.com/ethereum/solidity/issues/2691
        // solhint-disable-next-line no-inline-assembly
        assembly {
            chainId := chainid()
        }
    }
}

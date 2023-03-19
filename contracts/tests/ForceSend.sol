// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.6.10;

/**
 * @author Ribbon Team
 * @notice Contract to send native tokens for testing purposes
 */
contract ForceSend {
    /**
     * @notice sends native tokens to a given address
     * @param addr receiver address
     */
    function go(address payable addr) public payable {
        selfdestruct(addr);
    }
}

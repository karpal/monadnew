// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Gmonad {
    string public name = "Gmonad";

    function getMessage() public pure returns (string memory) {
        return "Hello from Gmonad!";
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VireVault} from "../src/VireVault.sol";

/// @notice Deploy VireVault to Celo Mainnet (42220) or Celo Sepolia (11142220) dry run.
/// @dev Requires strictly separate owner and settlementAgent addresses.
contract DeployVireVault is Script {
    // Verified Celo Mainnet (42220) USD₮ ERC-20 address (6 decimals)
    address internal constant CELO_MAINNET_USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;

    function run() external returns (VireVault deployed) {
        uint256 chainId = block.chainid;
        require(chainId == 42220 || chainId == 11142220, "DeployVireVault: unsupported chainId (use 42220 or 11142220)");

        uint256 deployerKey = vm.envUint("VIRE_OWNER_PRIVATE_KEY");
        address owner = vm.addr(deployerKey);
        address settlementAgent = vm.envAddress("VIRE_SETTLEMENT_AGENT_ADDRESS");
        address usdtToken = chainId == 42220
            ? CELO_MAINNET_USDT
            : vm.envAddress("CELO_SEPOLIA_USDT_ADDRESS");

        require(settlementAgent != address(0), "DeployVireVault: zero settlementAgent");
        require(settlementAgent != owner, "DeployVireVault: owner and settlementAgent must differ");

        vm.startBroadcast(deployerKey);
        deployed = new VireVault(usdtToken, owner, settlementAgent);
        vm.stopBroadcast();

        console2.log("VireVault deployed on chainId:", chainId);
        console2.log("VireVault address:", address(deployed));
        console2.log("USDt token:", usdtToken);
        console2.log("Owner:", owner);
        console2.log("SettlementAgent:", settlementAgent);
    }
}

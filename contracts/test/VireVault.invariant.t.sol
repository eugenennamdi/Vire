// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {VireVault} from "../src/VireVault.sol";
import {MockUSDT} from "./VireVault.t.sol";

contract VireVaultHandler is Test {
    VireVault public immutable vault;
    MockUSDT public immutable usdt;
    address public immutable owner;
    address public immutable agent;

    bytes32 public constant CAMPAIGN_ID = keccak256("invariant-corridor");
    address internal constant MOCK_TOKEN = address(0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f);

    uint256 public ghostTotalFunded;
    uint256 public ghostTotalWithdrawn;
    uint256 public ghostTotalNetReleased;
    bytes32[] public authorizedHashes;
    bytes32[] public completedHashes;
    uint256 internal nonce;

    address[4] internal recipients;

    constructor(VireVault _vault, MockUSDT _usdt, address _owner, address _agent) {
        vault = _vault;
        usdt = _usdt;
        owner = _owner;
        agent = _agent;

        recipients[0] = makeAddr("inv_r0");
        recipients[1] = makeAddr("inv_r1");
        recipients[2] = makeAddr("inv_r2");
        recipients[3] = makeAddr("inv_r3");

        ghostTotalFunded = 1_000e6;
    }

    function release(uint256 recipientIdx, uint256 amount) external {
        address recipient = recipients[recipientIdx % recipients.length];
        amount = bound(amount, 1e6, 50e6);
        bytes32 hash = keccak256(abi.encode("deliv", ++nonce));

        vm.prank(agent);
        try vault.releaseForSettlement(CAMPAIGN_ID, hash, recipient, amount) {
            ghostTotalNetReleased += amount;
            authorizedHashes.push(hash);
        } catch {}
    }

    function complete(uint256 idx, uint256 refundBps) external {
        if (authorizedHashes.length == 0) return;
        uint256 pos = idx % authorizedHashes.length;
        bytes32 hash = authorizedHashes[pos];

        (bytes32 cid, address recipient, uint256 releasedUsdt, , VireVault.SettlementStatus st) = vault.settlements(hash);
        if (st != VireVault.SettlementStatus.Authorized) return;

        refundBps = bound(refundBps, 0, 2000); // up to 20% unused refund
        uint256 refund = (releasedUsdt * refundBps) / 10_000;
        if (refund >= releasedUsdt) refund = 0;

        vm.prank(agent);
        try vault.recordSettlementReceipt(
            cid,
            hash,
            recipient,
            MOCK_TOKEN,
            10_000e6,
            keccak256(abi.encode("swap", hash)),
            keccak256(abi.encode("pay", hash)),
            "rfq_inv",
            refund
        ) {
            ghostTotalNetReleased -= refund;
            completedHashes.push(hash);
            authorizedHashes[pos] = authorizedHashes[authorizedHashes.length - 1];
            authorizedHashes.pop();
        } catch {}
    }

    function refundAuthorized(uint256 idx) external {
        if (authorizedHashes.length == 0) return;
        uint256 pos = idx % authorizedHashes.length;
        bytes32 hash = authorizedHashes[pos];

        (bytes32 cid, , uint256 releasedUsdt, , VireVault.SettlementStatus st) = vault.settlements(hash);
        if (st != VireVault.SettlementStatus.Authorized) return;

        vm.prank(agent);
        try vault.refundUnusedUsdt(cid, hash) {
            ghostTotalNetReleased -= releasedUsdt;
            authorizedHashes[pos] = authorizedHashes[authorizedHashes.length - 1];
            authorizedHashes.pop();
        } catch {}
    }

    function topUp(uint256 amount) external {
        amount = bound(amount, 1e6, 200e6);
        usdt.mint(owner, amount);
        vm.prank(owner);
        vault.topUpCampaign(CAMPAIGN_ID, amount);
        ghostTotalFunded += amount;
    }

    function adminWithdraw(uint256 amount) external {
        VireVault.Campaign memory c = vault.getCampaign(CAMPAIGN_ID);
        if (c.remainingBudget == 0) return;
        amount = bound(amount, 1, c.remainingBudget);
        vm.prank(owner);
        vault.adminWithdrawUnused(CAMPAIGN_ID, owner, amount);
        ghostTotalWithdrawn += amount;
    }

    function warpDay() external {
        vm.warp(block.timestamp + 1 days);
    }

    function completedCount() external view returns (uint256) {
        return completedHashes.length;
    }

    function recipientAt(uint256 idx) external view returns (address) {
        return recipients[idx];
    }
}

contract VireVaultInvariantTest is StdInvariant, Test {
    MockUSDT internal usdt;
    VireVault internal vault;
    VireVaultHandler internal handler;

    address internal owner = makeAddr("inv_owner");
    address internal agent = makeAddr("inv_agent");

    function setUp() public {
        vm.warp(1_764_000_000);
        usdt = new MockUSDT();
        vault = new VireVault(address(usdt), owner, agent);

        usdt.mint(owner, 1_000e6);
        vm.prank(owner);
        usdt.approve(address(vault), type(uint256).max);
        vm.prank(agent);
        usdt.approve(address(vault), type(uint256).max);

        vm.prank(owner);
        vault.createCampaign(
            keccak256("invariant-corridor"),
            1_000e6, // budget
            50e6,    // maxPerPayout
            150e6,   // dailyLimit
            5,       // maxPayoutsPerRecipient
            true
        );

        handler = new VireVaultHandler(vault, usdt, owner, agent);
        targetContract(address(handler));
    }

    /// @notice Vault token balance always covers committed remaining campaign budgets exactly.
    function invariant_VaultSolventAndAccountingExact() public view {
        VireVault.Campaign memory c = vault.getCampaign(handler.CAMPAIGN_ID());
        assertEq(vault.totalCampaignRemainingBudget(), c.remainingBudget);
        assertGe(usdt.balanceOf(address(vault)), vault.totalCampaignRemainingBudget());
        assertEq(
            c.remainingBudget + handler.ghostTotalNetReleased() + handler.ghostTotalWithdrawn(),
            handler.ghostTotalFunded()
        );
    }

    /// @notice No recipient ever exceeds maxPayoutsPerRecipient.
    function invariant_RecipientCapNeverExceeded() public view {
        VireVault.Campaign memory c = vault.getCampaign(handler.CAMPAIGN_ID());
        for (uint256 i = 0; i < 4; i++) {
            uint32 cnt = vault.recipientPayoutCount(handler.CAMPAIGN_ID(), handler.recipientAt(i));
            assertLe(cnt, c.maxPayoutsPerRecipient);
        }
    }

    /// @notice Daily spend in the active UTC bucket never exceeds dailyLimitUsdt.
    function invariant_DailyLimitNeverExceeded() public view {
        VireVault.Campaign memory c = vault.getCampaign(handler.CAMPAIGN_ID());
        uint64 bucket = uint64(block.timestamp / 1 days);
        assertLe(vault.dailySpent(handler.CAMPAIGN_ID(), bucket), c.dailyLimitUsdt);
    }

    /// @notice Every completed deliverable hash remains permanently marked used.
    function invariant_CompletedDeliverablesStayUsed() public view {
        uint256 len = handler.completedCount();
        for (uint256 i = 0; i < len; i++) {
            bytes32 h = handler.completedHashes(i);
            assertTrue(vault.usedDeliverableHashes(h));
        }
    }

    /// @notice Custody separation invariant: owner never equals settlementAgent.
    function invariant_OwnerAndAgentSeparated() public view {
        assertTrue(vault.owner() != vault.settlementAgent());
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {VireVault} from "../src/VireVault.sol";

/// @dev 6-decimal mock USD₮ matching Celo Mainnet USD₮ decimals (6).
contract MockUSDT is ERC20 {
    constructor() ERC20("Tether USD", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract VireVaultTest is Test {
    MockUSDT internal usdt;
    VireVault internal vault;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("settlementAgent");
    address internal merchant = makeAddr("merchant");
    address internal merchantMultisig = makeAddr("merchantMultisig");
    address internal recipient1 = makeAddr("recipient1");
    address internal recipient2 = makeAddr("recipient2");
    address internal attacker = makeAddr("attacker");

    bytes32 internal constant CAMPAIGN_CNGN = keccak256("gadget-retail-blackfriday-cngn");
    address internal constant MOCK_CNGN = address(0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f);

    uint256 internal constant ONE_USDT = 1e6;

    function setUp() public {
        vm.warp(1_764_000_000); // Realistic mainnet timestamp (> 1 day)
        usdt = new MockUSDT();
        vault = new VireVault(address(usdt), owner, agent);

        usdt.mint(owner, 10_000 * ONE_USDT);
        usdt.mint(merchant, 10_000 * ONE_USDT);

        vm.prank(owner);
        usdt.approve(address(vault), type(uint256).max);

        vm.prank(merchant);
        usdt.approve(address(vault), type(uint256).max);

        vm.prank(agent);
        usdt.approve(address(vault), type(uint256).max);
    }

    function _createDefaultCampaignAs(address creator) internal {
        vm.prank(creator);
        vault.createCampaign(
            CAMPAIGN_CNGN,
            500 * ONE_USDT, // budget
            25 * ONE_USDT,  // maxPerPayout
            100 * ONE_USDT, // dailyLimit
            3,              // maxPayoutsPerRecipient
            true
        );
    }

    function test_ConstructorRejectsInvalidConfig() public {
        vm.expectRevert(VireVault.ZeroAddress.selector);
        new VireVault(address(0), owner, agent);

        vm.expectRevert(VireVault.ZeroAddress.selector);
        new VireVault(address(usdt), owner, address(0));

        vm.expectRevert(VireVault.AgentCannotBeOwner.selector);
        new VireVault(address(usdt), owner, owner);
    }

    function test_PermissionlessMerchantCreateReleaseCompleteAndRefund() public {
        _createDefaultCampaignAs(merchant);

        VireVault.Campaign memory c = vault.getCampaign(CAMPAIGN_CNGN);
        assertEq(c.creator, merchant);
        assertEq(c.budgetUsdt, 500 * ONE_USDT);
        assertEq(c.remainingBudget, 500 * ONE_USDT);

        bytes32 deliverableHash = keccak256("promo-post-stage-1");
        uint256 released = 12 * ONE_USDT;
        uint256 unusedRefund = 500_000; // $0.50 slippage buffer returned

        vm.prank(agent);
        vault.releaseForSettlement(CAMPAIGN_CNGN, deliverableHash, recipient1, released);

        assertTrue(vault.usedDeliverableHashes(deliverableHash));
        assertEq(usdt.balanceOf(agent), released);
        assertEq(vault.getCampaign(CAMPAIGN_CNGN).remainingBudget, 488 * ONE_USDT);
        assertEq(vault.recipientPayoutCount(CAMPAIGN_CNGN, recipient1), 1);

        vm.prank(agent);
        vault.recordSettlementReceipt(
            CAMPAIGN_CNGN,
            deliverableHash,
            recipient1,
            MOCK_CNGN,
            15_000 * 1e6,
            keccak256("textile-swap-tx"),
            keccak256("local-payout-tx"),
            "rfq_01JTEST",
            unusedRefund
        );

        assertTrue(vault.usedDeliverableHashes(deliverableHash));
        assertEq(vault.getCampaign(CAMPAIGN_CNGN).remainingBudget, 488 * ONE_USDT + unusedRefund);
        assertEq(vault.totalCampaignRemainingBudget(), 488 * ONE_USDT + unusedRefund);
        assertEq(usdt.balanceOf(address(vault)), 488 * ONE_USDT + unusedRefund);
        assertEq(usdt.balanceOf(agent), released - unusedRefund);

        // Hard replay protection: completed hash can never be reused.
        vm.prank(agent);
        vm.expectRevert(VireVault.DeliverableAlreadyUsed.selector);
        vault.releaseForSettlement(CAMPAIGN_CNGN, deliverableHash, recipient1, 5 * ONE_USDT);
    }

    function test_NonCustodialCreatorCustodyAndTransfer() public {
        _createDefaultCampaignAs(merchant);

        // Protocol admin CANNOT withdraw, pause, top up, or change limits on a merchant's campaign.
        vm.prank(owner);
        vm.expectRevert(VireVault.UnauthorizedCampaignCreator.selector);
        vault.withdrawUnused(CAMPAIGN_CNGN, owner, 10 * ONE_USDT);

        vm.prank(owner);
        vm.expectRevert(VireVault.UnauthorizedCampaignCreator.selector);
        vault.setCampaignActive(CAMPAIGN_CNGN, false);

        vm.prank(attacker);
        vm.expectRevert(VireVault.UnauthorizedCampaignCreator.selector);
        vault.withdrawUnused(CAMPAIGN_CNGN, attacker, 10 * ONE_USDT);

        // Merchant can top up and pause their own campaign.
        vm.prank(merchant);
        vault.topUpCampaign(CAMPAIGN_CNGN, 50 * ONE_USDT);
        assertEq(vault.getCampaign(CAMPAIGN_CNGN).remainingBudget, 550 * ONE_USDT);

        // Even if protocol owner pauses the vault globally, merchant retains non-custodial withdrawal right.
        vm.prank(owner);
        vault.pause();

        uint256 merchantBefore = usdt.balanceOf(merchant);
        vm.prank(merchant);
        vault.withdrawUnused(CAMPAIGN_CNGN, merchant, 200 * ONE_USDT);
        assertEq(usdt.balanceOf(merchant), merchantBefore + 200 * ONE_USDT);
        assertEq(vault.getCampaign(CAMPAIGN_CNGN).remainingBudget, 350 * ONE_USDT);

        // Merchant hands custody to Safe multisig.
        vm.prank(merchant);
        vault.transferCampaignCreator(CAMPAIGN_CNGN, merchantMultisig);
        assertEq(vault.getCampaign(CAMPAIGN_CNGN).creator, merchantMultisig);

        // Old merchant loses control; new multisig controls remaining funds.
        vm.prank(merchant);
        vm.expectRevert(VireVault.UnauthorizedCampaignCreator.selector);
        vault.withdrawUnused(CAMPAIGN_CNGN, merchant, 10 * ONE_USDT);

        vm.prank(merchantMultisig);
        vault.withdrawUnused(CAMPAIGN_CNGN, merchantMultisig, 350 * ONE_USDT);
        assertEq(usdt.balanceOf(merchantMultisig), 350 * ONE_USDT);
        assertEq(vault.getCampaign(CAMPAIGN_CNGN).remainingBudget, 0);
    }

    function test_RefundUnusedUsdtRestoresBudgetAndAllowsRetry() public {
        _createDefaultCampaignAs(merchant);

        bytes32 deliverableHash = keccak256("quote-expired-deliverable");
        uint256 released = 10 * ONE_USDT;

        vm.prank(agent);
        vault.releaseForSettlement(CAMPAIGN_CNGN, deliverableHash, recipient1, released);
        assertEq(vault.getCampaign(CAMPAIGN_CNGN).remainingBudget, 490 * ONE_USDT);
        assertEq(vault.recipientPayoutCount(CAMPAIGN_CNGN, recipient1), 1);

        // Even if owner pauses vault while quote is in-flight, agent can return funds cleanly.
        vm.prank(owner);
        vault.pause();

        vm.prank(agent);
        vault.refundUnusedUsdt(CAMPAIGN_CNGN, deliverableHash);

        assertFalse(vault.usedDeliverableHashes(deliverableHash));
        assertEq(vault.getCampaign(CAMPAIGN_CNGN).remainingBudget, 500 * ONE_USDT);
        assertEq(vault.recipientPayoutCount(CAMPAIGN_CNGN, recipient1), 0);
        assertEq(vault.remainingDailyLimit(CAMPAIGN_CNGN), 100 * ONE_USDT);
        assertEq(usdt.balanceOf(address(vault)), 500 * ONE_USDT);

        // Unpause and retry succeeds.
        vm.prank(owner);
        vault.unpause();

        vm.prank(agent);
        vault.releaseForSettlement(CAMPAIGN_CNGN, deliverableHash, recipient1, released);
        assertTrue(vault.usedDeliverableHashes(deliverableHash));
    }

    function test_EnforcesPerPayoutCapDailyLimitAndRecipientCap() public {
        _createDefaultCampaignAs(merchant);

        // Exceeds maxPerPayoutUsdt (25)
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(VireVault.ExceedsMaxPerPayout.selector, 26 * ONE_USDT, 25 * ONE_USDT));
        vault.releaseForSettlement(CAMPAIGN_CNGN, keccak256("over-max"), recipient1, 26 * ONE_USDT);

        // Recipient cap = 3
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(agent);
            vault.releaseForSettlement(CAMPAIGN_CNGN, keccak256(abi.encode("r1", i)), recipient1, 20 * ONE_USDT);
        }
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(VireVault.ExceedsRecipientPayoutCap.selector, 3, 3));
        vault.releaseForSettlement(CAMPAIGN_CNGN, keccak256("r1-4th"), recipient1, 5 * ONE_USDT);

        // Daily spent is 60 USD₮ out of 100 USD₮. Recipient2 takes 25 + 20 -> second hits daily cap (105 > 100).
        vm.prank(agent);
        vault.releaseForSettlement(CAMPAIGN_CNGN, keccak256("r2-1"), recipient2, 25 * ONE_USDT);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(VireVault.ExceedsDailyLimit.selector, 105 * ONE_USDT, 100 * ONE_USDT)
        );
        vault.releaseForSettlement(CAMPAIGN_CNGN, keccak256("r2-2"), recipient2, 20 * ONE_USDT);

        // Next UTC day resets daily bucket cleanly.
        vm.warp(block.timestamp + 1 days);
        vm.prank(agent);
        vault.releaseForSettlement(CAMPAIGN_CNGN, keccak256("r2-2-nextday"), recipient2, 20 * ONE_USDT);
    }

    function test_BlocksSelfTradingCreatorWashAndUnauthorizedCallers() public {
        _createDefaultCampaignAs(merchant);

        // Agent cannot create a campaign
        usdt.mint(agent, 50 * ONE_USDT);
        vm.prank(agent);
        vm.expectRevert(VireVault.CreatorCannotBeAgent.selector);
        vault.createCampaign(keccak256("agent-camp"), 50 * ONE_USDT, 10 * ONE_USDT, 50 * ONE_USDT, 1, true);

        // Non-agent cannot release
        vm.prank(attacker);
        vm.expectRevert(VireVault.UnauthorizedAgent.selector);
        vault.releaseForSettlement(CAMPAIGN_CNGN, keccak256("h1"), recipient1, 5 * ONE_USDT);

        // Merchant cannot impersonate settlementAgent
        vm.prank(merchant);
        vm.expectRevert(VireVault.UnauthorizedAgent.selector);
        vault.releaseForSettlement(CAMPAIGN_CNGN, keccak256("h2"), recipient1, 5 * ONE_USDT);

        // Cannot settle to settlementAgent, owner, OR campaign creator (anti-wash-trade)
        vm.prank(agent);
        vm.expectRevert(VireVault.RecipientNotExternal.selector);
        vault.releaseForSettlement(CAMPAIGN_CNGN, keccak256("h3"), agent, 5 * ONE_USDT);

        vm.prank(agent);
        vm.expectRevert(VireVault.RecipientNotExternal.selector);
        vault.releaseForSettlement(CAMPAIGN_CNGN, keccak256("h4"), owner, 5 * ONE_USDT);

        vm.prank(agent);
        vm.expectRevert(VireVault.RecipientNotExternal.selector);
        vault.releaseForSettlement(CAMPAIGN_CNGN, keccak256("h5"), merchant, 5 * ONE_USDT);
    }

    function test_PauseStopsNewReleasesAndCreates() public {
        _createDefaultCampaignAs(merchant);

        vm.prank(owner);
        vault.pause();

        vm.prank(agent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.releaseForSettlement(CAMPAIGN_CNGN, keccak256("paused"), recipient1, 5 * ONE_USDT);

        vm.prank(merchant);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.createCampaign(keccak256("paused-create"), 10 * ONE_USDT, 5 * ONE_USDT, 10 * ONE_USDT, 1, true);
    }

    function test_TwoStepOwnershipCannotCollapseWithAgent() public {
        vm.prank(owner);
        vault.transferOwnership(agent);

        vm.prank(agent);
        vm.expectRevert(VireVault.AgentCannotBeOwner.selector);
        vault.acceptOwnership();
    }

    function testFuzz_ReleaseNeverExceedsBoundsOrReplays(
        uint256 budget,
        uint256 maxPerPayout,
        uint256 dailyLimit,
        uint256 requested,
        bytes32 deliverableHash
    ) public {
        vm.assume(deliverableHash != bytes32(0));
        budget = bound(budget, ONE_USDT, 5_000 * ONE_USDT);
        maxPerPayout = bound(maxPerPayout, ONE_USDT, budget);
        dailyLimit = bound(dailyLimit, maxPerPayout, budget);
        requested = bound(requested, 1, budget + 100 * ONE_USDT);

        bytes32 cid = keccak256(abi.encode("fuzz", budget, maxPerPayout, dailyLimit));
        vm.prank(merchant);
        vault.createCampaign(cid, budget, maxPerPayout, dailyLimit, 2, true);

        bool shouldSucceed = requested <= maxPerPayout && requested <= dailyLimit && requested <= budget;

        vm.prank(agent);
        if (!shouldSucceed) {
            vm.expectRevert();
            vault.releaseForSettlement(cid, deliverableHash, recipient1, requested);
            assertEq(vault.getCampaign(cid).remainingBudget, budget);
        } else {
            vault.releaseForSettlement(cid, deliverableHash, recipient1, requested);
            assertEq(vault.getCampaign(cid).remainingBudget, budget - requested);
            assertEq(usdt.balanceOf(address(vault)), vault.totalCampaignRemainingBudget());

            // Immediate replay must always revert.
            vm.prank(agent);
            vm.expectRevert(VireVault.DeliverableAlreadyUsed.selector);
            vault.releaseForSettlement(cid, deliverableHash, recipient2, ONE_USDT);
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title VireVault (v2 — Non-Custodial Multi-Tenant Settlement Vault)
/// @notice Policy-guarded USD₮ treasury separating per-campaign creator custody from autonomous agent execution.
/// @dev Any wallet can create and fund a campaign with deterministic onchain guardrails (per-payout cap,
///      rolling UTC daily limit, per-recipient cap, deliverable replay protection, external-recipient check).
///      Unspent USD₮ is strictly withdrawable ONLY by each campaign's creator, even if the vault is paused.
contract VireVault is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    enum SettlementStatus {
        None,
        Authorized,
        Completed,
        Refunded
    }

    struct Campaign {
        address creator;
        uint256 budgetUsdt;
        uint256 remainingBudget;
        uint256 maxPerPayoutUsdt;
        uint256 dailyLimitUsdt;
        uint32 maxPayoutsPerRecipient;
        bool active;
        bool exists;
    }

    struct SettlementRecord {
        bytes32 campaignId;
        address recipient;
        uint256 releasedUsdt;
        uint64 dayBucket;
        SettlementStatus status;
    }

    /// @notice Treasury settlement asset (USD₮ on Celo Mainnet: 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e, 6 decimals).
    IERC20 public immutable usdt;

    /// @notice Autonomous agent EOA allowed to pull bounded USD₮ as the Textile FX taker.
    address public settlementAgent;

    /// @notice Sum of remainingBudget across all campaigns; invariant: usdt.balanceOf(this) >= totalCampaignRemainingBudget.
    uint256 public totalCampaignRemainingBudget;

    /// @notice Campaign registry keyed by bytes32 campaignId.
    mapping(bytes32 => Campaign) public campaigns;

    /// @notice Hard replay protection flag per deliverable hash.
    ///         Set true atomically on releaseForSettlement; cleared ONLY on full refundUnusedUsdt.
    ///         Permanently true once Completed.
    mapping(bytes32 => bool) public usedDeliverableHashes;

    /// @notice Detailed settlement lifecycle per deliverable hash.
    mapping(bytes32 => SettlementRecord) public settlements;

    /// @notice Rolling UTC 24h spend: dailySpent[campaignId][block.timestamp / 1 days].
    mapping(bytes32 => mapping(uint64 => uint256)) public dailySpent;

    /// @notice Payout count per contributor per campaign (enables repeat missions while bounding abuse).
    mapping(bytes32 => mapping(address => uint32)) public recipientPayoutCount;

    event SettlementAgentUpdated(address indexed previousAgent, address indexed newAgent);

    event CampaignCreated(
        bytes32 indexed campaignId,
        address indexed creator,
        uint256 budgetUsdt,
        uint256 maxPerPayoutUsdt,
        uint256 dailyLimitUsdt,
        uint32 maxPayoutsPerRecipient,
        bool active
    );

    event CampaignToppedUp(bytes32 indexed campaignId, address indexed creator, uint256 addedUsdt, uint256 newRemainingBudget);
    event CampaignActiveUpdated(bytes32 indexed campaignId, bool active);
    event CampaignLimitsUpdated(
        bytes32 indexed campaignId,
        uint256 maxPerPayoutUsdt,
        uint256 dailyLimitUsdt,
        uint32 maxPayoutsPerRecipient
    );
    event CampaignCreatorTransferred(
        bytes32 indexed campaignId,
        address indexed previousCreator,
        address indexed newCreator
    );

    event SettlementAuthorized(
        bytes32 indexed campaignId,
        bytes32 indexed deliverableHash,
        address indexed recipient,
        uint256 usdtAmount,
        uint256 timestamp
    );

    event SettlementCompleted(
        bytes32 indexed campaignId,
        bytes32 indexed deliverableHash,
        address indexed recipient,
        address localToken,
        uint256 localAmount,
        uint256 netUsdtSpent,
        uint256 unusedUsdtRefunded,
        bytes32 textileSwapTxHash,
        bytes32 payoutTxHash,
        string quoteId,
        uint256 timestamp
    );

    event SettlementRefunded(
        bytes32 indexed campaignId,
        bytes32 indexed deliverableHash,
        address indexed recipient,
        uint256 refundedUsdt,
        uint256 timestamp
    );

    event CampaignUnusedWithdrawn(
        bytes32 indexed campaignId,
        address indexed creator,
        address indexed to,
        uint256 amount
    );

    error ZeroAddress();
    error ZeroAmount();
    error InvalidCampaignId();
    error InvalidDeliverableHash();
    error AgentCannotBeOwner();
    error CreatorCannotBeAgent();
    error UnauthorizedAgent();
    error UnauthorizedCampaignCreator();
    error CampaignAlreadyExists();
    error CampaignNotFound();
    error CampaignInactive();
    error InvalidLimits();
    error RecipientNotExternal();
    error DeliverableAlreadyUsed();
    error ExceedsMaxPerPayout(uint256 requested, uint256 maxAllowed);
    error ExceedsDailyLimit(uint256 projectedDailySpend, uint256 dailyLimit);
    error ExceedsRecipientPayoutCap(uint32 currentCount, uint32 maxAllowed);
    error InsufficientCampaignBudget(uint256 requested, uint256 remaining);
    error SettlementNotAuthorized();
    error SettlementMismatch();
    error InvalidReceiptData();
    error InvalidUnusedRefund(uint256 refundAmount, uint256 releasedAmount);
    error UnexpectedTransferDelta(uint256 expected, uint256 actual);

    modifier onlySettlementAgent() {
        if (msg.sender != settlementAgent) revert UnauthorizedAgent();
        _;
    }

    modifier onlyCampaignCreator(bytes32 campaignId) {
        Campaign storage c = campaigns[campaignId];
        if (!c.exists) revert CampaignNotFound();
        if (msg.sender != c.creator) revert UnauthorizedCampaignCreator();
        _;
    }

    constructor(
        address usdtToken,
        address initialOwner,
        address initialSettlementAgent
    ) Ownable(initialOwner) {
        if (usdtToken == address(0) || initialOwner == address(0) || initialSettlementAgent == address(0)) {
            revert ZeroAddress();
        }
        if (initialSettlementAgent == initialOwner) revert AgentCannotBeOwner();
        usdt = IERC20(usdtToken);
        settlementAgent = initialSettlementAgent;
        emit SettlementAgentUpdated(address(0), initialSettlementAgent);
    }

    /// @notice Update the autonomous settlementAgent EOA (protocol owner only; cannot equal owner).
    function setSettlementAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert ZeroAddress();
        if (newAgent == owner()) revert AgentCannotBeOwner();
        address prev = settlementAgent;
        settlementAgent = newAgent;
        emit SettlementAgentUpdated(prev, newAgent);
    }

    /// @notice Permissionlessly create and fund a new USD₮ campaign with deterministic onchain spending guardrails.
    /// @dev msg.sender becomes the campaign creator with exclusive custody over top-ups, pausing, limits, and withdrawals.
    function createCampaign(
        bytes32 campaignId,
        uint256 budgetUsdt,
        uint256 maxPerPayoutUsdt,
        uint256 dailyLimitUsdt,
        uint32 maxPayoutsPerRecipient,
        bool active
    ) external whenNotPaused nonReentrant {
        if (campaignId == bytes32(0)) revert InvalidCampaignId();
        if (msg.sender == settlementAgent) revert CreatorCannotBeAgent();
        if (campaigns[campaignId].exists) revert CampaignAlreadyExists();
        if (budgetUsdt == 0) revert ZeroAmount();
        if (maxPerPayoutUsdt == 0 || dailyLimitUsdt < maxPerPayoutUsdt || maxPayoutsPerRecipient == 0) {
            revert InvalidLimits();
        }

        campaigns[campaignId] = Campaign({
            creator: msg.sender,
            budgetUsdt: budgetUsdt,
            remainingBudget: budgetUsdt,
            maxPerPayoutUsdt: maxPerPayoutUsdt,
            dailyLimitUsdt: dailyLimitUsdt,
            maxPayoutsPerRecipient: maxPayoutsPerRecipient,
            active: active,
            exists: true
        });
        totalCampaignRemainingBudget += budgetUsdt;

        _pullExactUsdt(msg.sender, budgetUsdt);

        emit CampaignCreated(
            campaignId,
            msg.sender,
            budgetUsdt,
            maxPerPayoutUsdt,
            dailyLimitUsdt,
            maxPayoutsPerRecipient,
            active
        );
    }

    /// @notice Top up an existing campaign's USD₮ budget (campaign creator only).
    function topUpCampaign(
        bytes32 campaignId,
        uint256 additionalUsdt
    ) external onlyCampaignCreator(campaignId) nonReentrant {
        if (additionalUsdt == 0) revert ZeroAmount();
        Campaign storage c = campaigns[campaignId];

        c.budgetUsdt += additionalUsdt;
        c.remainingBudget += additionalUsdt;
        totalCampaignRemainingBudget += additionalUsdt;

        _pullExactUsdt(msg.sender, additionalUsdt);

        emit CampaignToppedUp(campaignId, msg.sender, additionalUsdt, c.remainingBudget);
    }

    /// @notice Pause or activate an individual campaign (campaign creator only).
    function setCampaignActive(bytes32 campaignId, bool active) external onlyCampaignCreator(campaignId) {
        campaigns[campaignId].active = active;
        emit CampaignActiveUpdated(campaignId, active);
    }

    /// @notice Update per-payout, daily, and per-recipient limits for an existing campaign (campaign creator only).
    function updateCampaignLimits(
        bytes32 campaignId,
        uint256 maxPerPayoutUsdt,
        uint256 dailyLimitUsdt,
        uint32 maxPayoutsPerRecipient
    ) external onlyCampaignCreator(campaignId) {
        if (maxPerPayoutUsdt == 0 || dailyLimitUsdt < maxPerPayoutUsdt || maxPayoutsPerRecipient == 0) {
            revert InvalidLimits();
        }
        Campaign storage c = campaigns[campaignId];
        c.maxPerPayoutUsdt = maxPerPayoutUsdt;
        c.dailyLimitUsdt = dailyLimitUsdt;
        c.maxPayoutsPerRecipient = maxPayoutsPerRecipient;
        emit CampaignLimitsUpdated(campaignId, maxPerPayoutUsdt, dailyLimitUsdt, maxPayoutsPerRecipient);
    }

    /// @notice Transfer custody of a campaign to another wallet or Safe multisig (campaign creator only).
    function transferCampaignCreator(
        bytes32 campaignId,
        address newCreator
    ) external onlyCampaignCreator(campaignId) {
        if (newCreator == address(0)) revert ZeroAddress();
        if (newCreator == settlementAgent) revert CreatorCannotBeAgent();
        address prev = campaigns[campaignId].creator;
        campaigns[campaignId].creator = newCreator;
        emit CampaignCreatorTransferred(campaignId, prev, newCreator);
    }

    /// @notice Withdraw unused USD₮ from a campaign back to a creator-chosen address (campaign creator only).
    /// @dev Intentionally callable even while paused so creators always retain non-custodial exit rights.
    function withdrawUnused(
        bytes32 campaignId,
        address to,
        uint256 amount
    ) external onlyCampaignCreator(campaignId) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        Campaign storage c = campaigns[campaignId];
        if (amount > c.remainingBudget) {
            revert InsufficientCampaignBudget(amount, c.remainingBudget);
        }

        c.remainingBudget -= amount;
        totalCampaignRemainingBudget -= amount;

        usdt.safeTransfer(to, amount);

        emit CampaignUnusedWithdrawn(campaignId, msg.sender, to, amount);
    }

    /// @notice Release bounded USD₮ to settlementAgent (the Textile taker EOA) for one verified deliverable.
    /// @dev Enforces replay protection, per-payout cap, rolling 24h daily cap, per-recipient repeat cap,
    ///      campaign remaining budget, and non-creator/non-team external recipient checks atomically.
    function releaseForSettlement(
        bytes32 campaignId,
        bytes32 deliverableHash,
        address recipient,
        uint256 exactUsdtNeeded
    ) external onlySettlementAgent whenNotPaused nonReentrant {
        if (deliverableHash == bytes32(0)) revert InvalidDeliverableHash();
        if (exactUsdtNeeded == 0) revert ZeroAmount();

        Campaign storage c = campaigns[campaignId];
        if (!c.exists) revert CampaignNotFound();
        if (!c.active) revert CampaignInactive();

        if (
            recipient == address(0) ||
            recipient == settlementAgent ||
            recipient == owner() ||
            recipient == c.creator
        ) {
            revert RecipientNotExternal();
        }

        SettlementRecord storage rec = settlements[deliverableHash];
        if (
            usedDeliverableHashes[deliverableHash] ||
            rec.status == SettlementStatus.Authorized ||
            rec.status == SettlementStatus.Completed
        ) {
            revert DeliverableAlreadyUsed();
        }

        if (exactUsdtNeeded > c.maxPerPayoutUsdt) {
            revert ExceedsMaxPerPayout(exactUsdtNeeded, c.maxPerPayoutUsdt);
        }

        uint64 dayBucket = uint64(block.timestamp / 1 days);
        uint256 projectedDaily = dailySpent[campaignId][dayBucket] + exactUsdtNeeded;
        if (projectedDaily > c.dailyLimitUsdt) {
            revert ExceedsDailyLimit(projectedDaily, c.dailyLimitUsdt);
        }

        uint32 currentCount = recipientPayoutCount[campaignId][recipient];
        if (currentCount >= c.maxPayoutsPerRecipient) {
            revert ExceedsRecipientPayoutCap(currentCount, c.maxPayoutsPerRecipient);
        }

        if (exactUsdtNeeded > c.remainingBudget) {
            revert InsufficientCampaignBudget(exactUsdtNeeded, c.remainingBudget);
        }

        // Strict Checks-Effects-Interactions: commit all state mutations before token transfer.
        usedDeliverableHashes[deliverableHash] = true;
        settlements[deliverableHash] = SettlementRecord({
            campaignId: campaignId,
            recipient: recipient,
            releasedUsdt: exactUsdtNeeded,
            dayBucket: dayBucket,
            status: SettlementStatus.Authorized
        });
        c.remainingBudget -= exactUsdtNeeded;
        totalCampaignRemainingBudget -= exactUsdtNeeded;
        dailySpent[campaignId][dayBucket] = projectedDaily;
        recipientPayoutCount[campaignId][recipient] = currentCount + 1;

        usdt.safeTransfer(settlementAgent, exactUsdtNeeded);

        emit SettlementAuthorized(campaignId, deliverableHash, recipient, exactUsdtNeeded, block.timestamp);
    }

    /// @notice Record an immutable onchain settlement receipt after Textile FX swap + local payout complete.
    /// @dev Intentionally callable while paused so in-flight settlements can finalize and return unused USD₮.
    function recordSettlementReceipt(
        bytes32 campaignId,
        bytes32 deliverableHash,
        address recipient,
        address localToken,
        uint256 localAmount,
        bytes32 textileSwapTxHash,
        bytes32 payoutTxHash,
        string calldata quoteId,
        uint256 unusedUsdtRefund
    ) external onlySettlementAgent nonReentrant {
        SettlementRecord storage rec = settlements[deliverableHash];
        if (rec.status != SettlementStatus.Authorized) revert SettlementNotAuthorized();
        if (rec.campaignId != campaignId || rec.recipient != recipient) revert SettlementMismatch();
        if (
            localToken == address(0) ||
            localAmount == 0 ||
            textileSwapTxHash == bytes32(0) ||
            payoutTxHash == bytes32(0) ||
            bytes(quoteId).length == 0
        ) {
            revert InvalidReceiptData();
        }
        if (unusedUsdtRefund >= rec.releasedUsdt) {
            revert InvalidUnusedRefund(unusedUsdtRefund, rec.releasedUsdt);
        }

        rec.status = SettlementStatus.Completed;
        // usedDeliverableHashes[deliverableHash] remains permanently true.

        uint256 netUsdtSpent = rec.releasedUsdt - unusedUsdtRefund;

        if (unusedUsdtRefund > 0) {
            campaigns[campaignId].remainingBudget += unusedUsdtRefund;
            totalCampaignRemainingBudget += unusedUsdtRefund;
            dailySpent[campaignId][rec.dayBucket] -= unusedUsdtRefund;
            _pullExactUsdt(settlementAgent, unusedUsdtRefund);
        }

        emit SettlementCompleted(
            campaignId,
            deliverableHash,
            recipient,
            localToken,
            localAmount,
            netUsdtSpent,
            unusedUsdtRefund,
            textileSwapTxHash,
            payoutTxHash,
            quoteId,
            block.timestamp
        );
    }

    /// @notice Refund 100% of released USD₮ back into the campaign if a Textile quote expires or fails before fill.
    /// @dev Callable while paused since it strictly increases vault solvency.
    function refundUnusedUsdt(bytes32 campaignId, bytes32 deliverableHash) external onlySettlementAgent nonReentrant {
        SettlementRecord storage rec = settlements[deliverableHash];
        if (rec.status != SettlementStatus.Authorized) revert SettlementNotAuthorized();
        if (rec.campaignId != campaignId) revert SettlementMismatch();

        uint256 amount = rec.releasedUsdt;
        address recipient = rec.recipient;
        uint64 dayBucket = rec.dayBucket;

        rec.status = SettlementStatus.Refunded;
        usedDeliverableHashes[deliverableHash] = false;
        campaigns[campaignId].remainingBudget += amount;
        totalCampaignRemainingBudget += amount;
        dailySpent[campaignId][dayBucket] -= amount;
        recipientPayoutCount[campaignId][recipient] -= 1;

        _pullExactUsdt(settlementAgent, amount);

        emit SettlementRefunded(campaignId, deliverableHash, recipient, amount, block.timestamp);
    }

    /// @notice Emergency pause stopping all new campaign creations and settlement releases.
    /// @dev Campaign creators can still call withdrawUnused() while paused.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume campaign creations and settlement releases.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Return full campaign struct including creator address.
    function getCampaign(bytes32 campaignId) external view returns (Campaign memory) {
        return campaigns[campaignId];
    }

    /// @notice Return remaining USD₮ spendable today (UTC day bucket) for a campaign.
    function remainingDailyLimit(bytes32 campaignId) external view returns (uint256) {
        Campaign storage c = campaigns[campaignId];
        if (!c.exists) return 0;
        uint64 dayBucket = uint64(block.timestamp / 1 days);
        uint256 spent = dailySpent[campaignId][dayBucket];
        if (spent >= c.dailyLimitUsdt) return 0;
        return c.dailyLimitUsdt - spent;
    }

    /// @dev Prevent two-step ownership transfer from collapsing owner and settlementAgent into one address.
    function _transferOwnership(address newOwner) internal override {
        if (newOwner != address(0) && newOwner == settlementAgent) revert AgentCannotBeOwner();
        super._transferOwnership(newOwner);
    }

    function _pullExactUsdt(address from, uint256 amount) internal {
        uint256 beforeBal = usdt.balanceOf(address(this));
        usdt.safeTransferFrom(from, address(this), amount);
        uint256 actual = usdt.balanceOf(address(this)) - beforeBal;
        if (actual != amount) revert UnexpectedTransferDelta(amount, actual);
    }
}

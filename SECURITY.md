# Security Policy

Security is foundational to **Vire**. Because `VireVault` escrows live stablecoin treasuries on Celo Mainnet (`42220`) and clears exact-output FX payouts autonomously, we treat every smart contract, settlement, and API vulnerability with top priority.

## Scope

The following components are in scope for security reports:

| Component | Location / Address |
|---|---|
| **VireVault v2 (Celo Mainnet `42220`)** | [`0x8969060F1605A6C351210323169Efb226667b26f`](https://celoscan.io/address/0x8969060F1605A6C351210323169Efb226667b26f) · `contracts/src/VireVault.sol` |
| **Settlement & Policy Engine** | `packages/agent`, `packages/textile`, `packages/celo-infra`, `packages/shared` |
| **Web App & API Surface** | `https://usevire.xyz` · `apps/web/src/app/api/**` |
| **Machine-Payable x402 Endpoints** | `/api/x402/verify`, `/api/x402/campaigns` |

## Reporting a Vulnerability

**Please do not open public GitHub issues for suspected security vulnerabilities.**

Report vulnerabilities privately through GitHub's Private Vulnerability Reporting flow:

- **GitHub Security Advisories**: https://github.com/eugenennamdi/Vire/security/advisories/new

Include as much of the following as possible so we can reproduce and remediate quickly:

- Clear description of the vulnerability and potential impact (e.g., unauthorized fund release, limit bypass, replay attack, auth bypass, SSRF, or secret exposure)
- Affected contract function, API route, or package file
- Step-by-step reproduction instructions or a minimal Foundry / Vitest proof-of-concept test
- Any suggested remediation

### Disclosure & Response Commitments

- **Initial acknowledgment**: Within 24–48 hours of receipt
- **Triage & severity assessment**: Within 72 hours
- **Coordinated disclosure**: We ask that you give us reasonable time to patch and verify fixes (or pause affected onchain pathways if required) before public disclosure
- **Safe harbor**: Please test exclusively against local forks or unit test suites (`pnpm test` / `pnpm test:contracts`) — never test exploits against live Celo Mainnet funds or active user campaigns

## Security Architecture Summary

Vire enforces defense-in-depth across onchain custody and off-chain verification:

- **Non-Custodial Campaign Isolation (`VireVault v2`)**: Built with OpenZeppelin `Ownable2Step`, `ReentrancyGuard`, `Pausable`, and `SafeERC20` using strict Checks-Effects-Interactions and balance-delta accounting. Unspent funds in each campaign are withdrawable exclusively by that campaign's creator via `withdrawUnused()`, even while the vault is globally paused.
- **Deterministic Onchain Limits**: `maxPerPayoutUsdt`, rolling 24h UTC `dailyLimitUsdt`, `maxPayoutsPerRecipient`, `remainingBudget`, and atomic deliverable replay protection (`usedDeliverableHashes`) are enforced onchain regardless of off-chain agent behavior.
- **Strict Role Separation**: `settlementAgent`, vault `owner()`, and campaign `creator` are prevented from receiving payouts (`RecipientNotExternal`) and from collapsing into one address (`AgentCannotBeOwner`, `CreatorCannotBeAgent`).
- **Allowlisted FX Targets**: Textile FX approvals and swaps are restricted strictly to verified `LimitOrderReactor` and `VaultOrderExecutor` mainnet contracts.
- **Hardened Off-Chain Pipeline**: SSRF-guarded artifact fetching, EIP-191 wallet/identity verification, server-side-only hashed voucher & claim secrets, and continuous Foundry unit, fuzz, and stateful invariant testing (`pnpm test:contracts`).

## Out of Scope

- Third-party upstream protocols, wallets, and off-ramp providers (Textile FX makers, Ripio, Opera MiniPay, Privy, Celo RPC providers)
- Social engineering, phishing, or physical attacks
- Rate-limiting or volumetric DoS without concrete protocol or treasury impact
- Theoretical issues without a reproducible proof of concept

import { createClient } from "@libsql/client";
import {
  appendAttributionSuffixSafe,
  CeloBuyClient,
  createCeloPublicClient,
  decodeAttributionSuffix,
  getAgentIdentity,
  getReputationSummary,
  verifyAttributionTx,
} from "@vire/celo-infra";
import {
  CELO_CONTRACTS,
  CELO_MAINNET_CHAIN_ID,
  CELO_TOKENS,
  computeImpliedRateLocalPerUsdt,
  CORRIDORS,
  DEFAULT_ATTRIBUTION_CODE,
  DEFAULT_BUY_GATEWAY_URL,
  DEFAULT_CELO_RPC_URL,
  DEFAULT_TEXTILE_API_URL,
  DEFAULT_X402_FACILITATOR_URL,
  formatTokenAmount,
  parseTokenAmount,
  PRIMARY_CORRIDORS,
  validateAttributionCode,
  VIRE_VAULT_ABI,
  type CorridorSymbol,
} from "@vire/shared";
import { TextileClient } from "@vire/textile";
import { erc20Abi, formatEther, getAddress, isAddress, type Address, type Hash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadDotEnv } from "./load-env.js";

loadDotEnv();

type CheckStatus = "PASS" | "WARN" | "FAIL";

interface CheckResult {
  section: string;
  name: string;
  status: CheckStatus;
  detail: string;
}

const results: CheckResult[] = [];

function record(section: string, name: string, status: CheckStatus, detail: string) {
  results.push({ section, name, status, detail });
  const icon = status === "PASS" ? "[PASS]" : status === "WARN" ? "[WARN]" : "[FAIL]";
  console.log(`  ${icon} ${name}: ${detail}`);
}

const ADAPTER_ABI = [
  {
    type: "function",
    name: "getAdaptedToken",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

const SAMPLE_PREVIEW_HUMAN: Record<CorridorSymbol, string> = {
  cNGN: "3000",
  wARS: "2500",
  wBRL: "12",
  wMXN: "40",
  IDRX: "35000",
  wCOP: "9000",
};

async function main() {
  console.log("========================================================================");
  console.log("  VIRE DOCTOR — Non-Destructive Celo Mainnet (42220) Live Diagnostics");
  console.log("========================================================================\n");

  const rpcUrl = process.env.CELO_RPC_URL?.trim() || DEFAULT_CELO_RPC_URL;
  const attributionCode = validateAttributionCode(
    process.env.VIRE_ATTRIBUTION_CODE || DEFAULT_ATTRIBUTION_CODE
  );
  const publicClient = createCeloPublicClient({ rpcUrl, chainId: CELO_MAINNET_CHAIN_ID });

  // 1. Celo Mainnet RPC Connectivity
  console.log("1) Celo Mainnet RPC Connectivity");
  try {
    const start = Date.now();
    const [chainId, blockNumber] = await Promise.all([
      publicClient.getChainId(),
      publicClient.getBlockNumber(),
    ]);
    const ms = Date.now() - start;
    if (chainId === CELO_MAINNET_CHAIN_ID) {
      record("rpc", "Chain ID & Head", "PASS", `chainId=${chainId}, block=${blockNumber} (${ms}ms via ${rpcUrl})`);
    } else {
      record("rpc", "Chain ID & Head", "FAIL", `Expected chainId 42220, got ${chainId}`);
    }
  } catch (err) {
    record("rpc", "Chain ID & Head", "FAIL", err instanceof Error ? err.message : String(err));
  }

  // 2. Verified Onchain Token decimals() & CIP-64 USD₮ FeeCurrency Adapter
  console.log("\n2) Verified Onchain Token decimals() & CIP-64 Adapter");
  await Promise.all(
    Object.values(CELO_TOKENS).map(async (token) => {
      try {
        const onchainDecimals = await publicClient.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "decimals",
        });
        if (onchainDecimals === token.decimals) {
          record(
            "tokens",
            `${token.displaySymbol} (${token.address.slice(0, 8)}…)`,
            "PASS",
            `onchain decimals() === ${onchainDecimals}`
          );
        } else {
          record(
            "tokens",
            `${token.displaySymbol} decimals mismatch`,
            "FAIL",
            `Expected ${token.decimals}, onchain returned ${onchainDecimals}`
          );
        }
      } catch (err) {
        record(
          "tokens",
          `${token.displaySymbol} decimals()`,
          "FAIL",
          err instanceof Error ? err.message : String(err)
        );
      }
    })
  );

  try {
    const adapted = await publicClient.readContract({
      address: CELO_CONTRACTS.USDT_FEE_ADAPTER,
      abi: ADAPTER_ABI,
      functionName: "getAdaptedToken",
    });
    if (adapted.toLowerCase() === CELO_TOKENS.USDT.address.toLowerCase()) {
      record(
        "tokens",
        "USD₮ CIP-64 FeeCurrency Adapter",
        "PASS",
        `${CELO_CONTRACTS.USDT_FEE_ADAPTER} → adapts USD₮ (${adapted})`
      );
    } else {
      record("tokens", "USD₮ CIP-64 FeeCurrency Adapter", "FAIL", `Unexpected adapted token ${adapted}`);
    }
  } catch (err) {
    record("tokens", "USD₮ CIP-64 FeeCurrency Adapter", "FAIL", err instanceof Error ? err.message : String(err));
  }

  // 3. VireVault Deployment, Roles & Live USD₮ Balance
  console.log("\n3) VireVault Contract & Custody Guardrails");
  const rawVault = process.env.VIRE_VAULT_ADDRESS?.trim();
  if (!rawVault || !isAddress(rawVault)) {
    record(
      "vault",
      "VireVault Deployment",
      "WARN",
      "VIRE_VAULT_ADDRESS not set yet. Deploy with forge script contracts/script/DeployVireVault.s.sol --rpc-url celo --broadcast"
    );
  } else {
    const vaultAddr = getAddress(rawVault);
    try {
      const [code, owner, agent, paused, usdtAddr, usdtBal, committed] = await Promise.all([
        publicClient.getBytecode({ address: vaultAddr }),
        publicClient.readContract({ address: vaultAddr, abi: VIRE_VAULT_ABI, functionName: "owner" }),
        publicClient.readContract({ address: vaultAddr, abi: VIRE_VAULT_ABI, functionName: "settlementAgent" }),
        publicClient.readContract({ address: vaultAddr, abi: VIRE_VAULT_ABI, functionName: "paused" }),
        publicClient.readContract({ address: vaultAddr, abi: VIRE_VAULT_ABI, functionName: "usdt" }),
        publicClient.readContract({
          address: CELO_TOKENS.USDT.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [vaultAddr],
        }),
        publicClient.readContract({
          address: vaultAddr,
          abi: VIRE_VAULT_ABI,
          functionName: "totalCampaignRemainingBudget",
        }),
      ]);

      if (!code || code.length <= 2) {
        record("vault", "VireVault Bytecode", "FAIL", `No bytecode at ${vaultAddr}`);
      } else {
        record("vault", "VireVault Bytecode", "PASS", `Deployed at ${vaultAddr}`);
      }

      if (owner.toLowerCase() !== agent.toLowerCase()) {
        record("vault", "Custody Role Separation", "PASS", `owner=${owner} != agent=${agent}`);
      } else {
        record("vault", "Custody Role Separation", "FAIL", "owner and settlementAgent must be distinct");
      }

      if (usdtAddr.toLowerCase() === CELO_TOKENS.USDT.address.toLowerCase()) {
        record(
          "vault",
          "Vault Solvency & State",
          paused ? "WARN" : "PASS",
          `paused=${paused}, balance=${formatTokenAmount(usdtBal, "USDT", 2)} USD₮, committed=${formatTokenAmount(committed, "USDT", 2)} USD₮`
        );
      } else {
        record("vault", "Vault USD₮ Token", "FAIL", `Unexpected vault usdt()=${usdtAddr}`);
      }
    } catch (err) {
      record("vault", "VireVault Read", "FAIL", err instanceof Error ? err.message : String(err));
    }
  }

  // 4. ERC-8004 Identity & Reputation Registries
  console.log("\n4) ERC-8004 Agent Identity & Reputation");
  try {
    const [idCode, repCode] = await Promise.all([
      publicClient.getBytecode({ address: CELO_CONTRACTS.ERC8004_IDENTITY_REGISTRY }),
      publicClient.getBytecode({ address: CELO_CONTRACTS.ERC8004_REPUTATION_REGISTRY }),
    ]);
    if (idCode && idCode.length > 2 && repCode && repCode.length > 2) {
      record("erc8004", "Canonical Celo Mainnet Registries", "PASS", "Identity & Reputation bytecode verified");
    } else {
      record("erc8004", "Canonical Celo Mainnet Registries", "FAIL", "Missing registry bytecode on 42220");
    }
  } catch (err) {
    record("erc8004", "Canonical Registries", "FAIL", err instanceof Error ? err.message : String(err));
  }

  const rawAgentId = process.env.VIRE_AGENT_ID?.trim();
  if (!rawAgentId || !/^\d+$/.test(rawAgentId)) {
    record(
      "erc8004",
      "Vire ERC-8004 Agent ID",
      "WARN",
      "VIRE_AGENT_ID not set yet. Register once via `pnpm register-agent`."
    );
  } else {
    try {
      const agentId = BigInt(rawAgentId);
      const [identity, summary] = await Promise.all([
        getAgentIdentity({ publicClient, agentId }),
        getReputationSummary({ publicClient, agentId }),
      ]);
      record(
        "erc8004",
        `Agent #${rawAgentId} Ownership`,
        "PASS",
        `owner=${identity.owner}, uri=${identity.agentUri}`
      );
      record(
        "erc8004",
        "Reputation Summary (tag=settlement)",
        "PASS",
        `clients=${summary.clientCount}, count=${summary.feedbackCount}, avg=${summary.averageScore ?? "n/a"}`
      );
    } catch (err) {
      record("erc8004", `Agent #${rawAgentId}`, "FAIL", err instanceof Error ? err.message : String(err));
    }
  }

  // 5. Live Textile FX v2 Previews across Primary Corridors
  console.log("\n5) Live Textile FX v2 Corridor Previews (Zero RFQ Slots Consumed)");
  const textile = new TextileClient({
    baseUrl: process.env.TEXTILE_API_BASE_URL?.trim() || DEFAULT_TEXTILE_API_URL,
    apiKey: process.env.TEXTILE_API_KEY?.trim() || undefined,
    builderCodes: [attributionCode],
  });
  record(
    "textile",
    "Partner Key Mode",
    textile.hasPartnerApiKey ? "PASS" : "WARN",
    textile.hasPartnerApiKey
      ? `Configured (includeAttribution=true, builderCodes=[${attributionCode}])`
      : "TEXTILE_API_KEY unset — keyless takerProof mode active (set Partner API key for Textile ERC-8021 tags)"
  );

  let liveCorridorsOk = 0;
  for (const sym of PRIMARY_CORRIDORS) {
    const meta = CORRIDORS[sym];
    const sampleAtomic = parseTokenAmount(SAMPLE_PREVIEW_HUMAN[sym], sym).toString();
    try {
      const prev = await textile.previewExactOutput({
        buyToken: meta.tokenAddress,
        buyAmountAtomic: sampleAtomic,
      });
      if (prev.status === "preview" && prev.takerPays) {
        liveCorridorsOk += 1;
        const rate = computeImpliedRateLocalPerUsdt(sampleAtomic, prev.takerPays, sym);
        record(
          "textile",
          `USD₮ → ${sym} (${meta.decimals}dp)`,
          "PASS",
          `buy ${SAMPLE_PREVIEW_HUMAN[sym]} ${sym} = $${formatTokenAmount(prev.takerPays, "USDT", 4)} USD₮ (rate ${rate.toFixed(2)} ${meta.fiatCode}/USD₮)`
        );
      } else {
        record(
          "textile",
          `USD₮ → ${sym} (${meta.decimals}dp)`,
          "WARN",
          `no_quote (${prev.reason ?? "makers currently offline"}${prev.feed ? `, feed=${prev.feed.status}` : ""})`
        );
      }
    } catch (err) {
      record("textile", `USD₮ → ${sym}`, "FAIL", err instanceof Error ? err.message : String(err));
    }
  }
  if (liveCorridorsOk === 0) {
    record("textile", "Corridor Availability", "FAIL", "Zero primary Textile corridors returned live preview quotes");
  }

  // 6. Celo `buy` API Gateway & Agent Wallet Balance
  console.log("\n6) Celo `buy` API Gateway & Agent Wallet Balance");
  try {
    const buyClient = new CeloBuyClient({
      gatewayUrl: process.env.BUY_GATEWAY_URL?.trim() || DEFAULT_BUY_GATEWAY_URL,
      dryRun: true,
    });
    const catalog = await buyClient.fetchCatalog();
    const cencori = catalog.capabilities.find((c) => c.id === "cencori.v1.chat.completions");
    const chainstack = catalog.capabilities.find((c) => c.id === "chainstack.celo");
    record(
      "buy",
      "Gateway Catalog (gateway.usebuy.ai)",
      cencori?.available && chainstack?.available ? "PASS" : "WARN",
      `capabilities=${catalog.capabilities.length}, cencori=${Boolean(cencori?.available)} ($${cencori?.price?.usd ?? "?"}), chainstack=${Boolean(chainstack?.available)} ($${chainstack?.price?.usd ?? "?"})`
    );
  } catch (err) {
    record("buy", "Gateway Catalog", "FAIL", err instanceof Error ? err.message : String(err));
  }

  const pk = process.env.VIRE_AGENT_PRIVATE_KEY?.trim();
  if (pk && /^0x[0-9a-fA-F]{64}$/.test(pk)) {
    const agentAddr = privateKeyToAccount(pk as Hex).address;
    try {
      const [celoBal, usdtBal, usdcBal] = await Promise.all([
        publicClient.getBalance({ address: agentAddr }),
        publicClient.readContract({ address: CELO_TOKENS.USDT.address, abi: erc20Abi, functionName: "balanceOf", args: [agentAddr] }),
        publicClient.readContract({ address: CELO_TOKENS.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: [agentAddr] }),
      ]);
      record(
        "buy",
        `Agent Wallet (${agentAddr.slice(0, 10)}…)`,
        usdtBal > 0n || usdcBal > 0n ? "PASS" : "WARN",
        `CELO=${Number(formatEther(celoBal)).toFixed(4)}, USD₮=${formatTokenAmount(usdtBal, "USDT", 4)}, USDC=${formatTokenAmount(usdcBal, "USDC", 4)}`
      );
    } catch (err) {
      record("buy", "Agent Balance", "FAIL", err instanceof Error ? err.message : String(err));
    }
  } else {
    record("buy", "Agent Wallet Balance", "WARN", "VIRE_AGENT_PRIVATE_KEY not set in .env");
  }

  // 7. Celo x402 Facilitator & Local 402 Challenge Verification
  console.log("\n7) Celo x402 Facilitator & 402 Payment Required Challenge");
  const facilitatorUrl = (process.env.X402_FACILITATOR_URL?.trim() || DEFAULT_X402_FACILITATOR_URL).replace(/\/+$/, "");
  try {
    const supRes = await fetch(`${facilitatorUrl}/supported`, { signal: AbortSignal.timeout(15_000) });
    if (!supRes.ok) throw new Error(`HTTP ${supRes.status}`);
    const supJson = (await supRes.json()) as {
      kinds?: Array<{ x402Version?: number; network?: string; extra?: { supportedAssets?: Array<{ symbol?: string }> } }>;
      extensions?: string[];
    };
    const v2Celo = supJson.kinds?.find((k) => k.x402Version === 2 && k.network === "eip155:42220");
    const symbols = v2Celo?.extra?.supportedAssets?.map((a) => a.symbol).filter(Boolean) ?? [];
    const hasSponsor = supJson.extensions?.includes("eip2612GasSponsoring") ?? false;
    record(
      "x402",
      "Facilitator /supported (api.x402.celo.org)",
      v2Celo && hasSponsor ? "PASS" : "FAIL",
      `eip155:42220 v2 active, eip2612GasSponsoring=${hasSponsor}, assets=[${symbols.join(",")}]`
    );
  } catch (err) {
    record("x402", "Facilitator /supported", "FAIL", err instanceof Error ? err.message : String(err));
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    try {
      const probeRes = await fetch(`${appUrl.replace(/\/+$/, "")}/api/x402/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliverableUrl: "https://example.com",
          deliverableType: "promo_post",
          criteria: "Doctor probe",
          corridor: "cNGN",
          rewardLocalHuman: "3000",
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (probeRes.status === 402 && probeRes.headers.get("payment-required")) {
        record("x402", "Endpoint /api/x402/verify Challenge", "PASS", `HTTP 402 + payment-required header verified at ${appUrl}`);
      } else {
        record(
          "x402",
          "Endpoint /api/x402/verify Challenge",
          "WARN",
          `HTTP ${probeRes.status} at ${appUrl} (start server & set VIRE_X402_PAY_TO to verify live 402)`
        );
      }
    } catch {
      record(
        "x402",
        "Endpoint /api/x402/verify Challenge",
        "WARN",
        `App not currently listening at ${appUrl} (run \`pnpm dev\` or point NEXT_PUBLIC_APP_URL at deployment)`
      );
    }
  }

  // 8. Programmatic ERC-8021 Attribution Verification (Offline + Recent Mainnet Txs)
  console.log("\n8) ERC-8021 Attribution Tag Verification (@celo/attribution-tags)");
  const testTagged = appendAttributionSuffixSafe("0x12345678", attributionCode);
  const decoded = decodeAttributionSuffix(testTagged);
  if (decoded && decoded.codes.length === 1 && decoded.codes[0] === attributionCode) {
    record("erc8021", "Local Tag Encoding & Decoding", "PASS", `Single code verified: [${decoded.codes.join(",")}] (schema ${decoded.schemaId})`);
  } else {
    record("erc8021", "Local Tag Encoding & Decoding", "FAIL", "Failed to decode ERC-8021 suffix");
  }

  // Collect tx hashes from CLI --tx=0x..., env DOCTOR_VERIFY_TX_HASHES, or local SQLite settlements table
  const txHashes = new Set<Hash>();
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--tx=0x") && arg.length === 71) {
      txHashes.add(arg.slice(5) as Hash);
    }
  }
  for (const raw of (process.env.DOCTOR_VERIFY_TX_HASHES ?? "").split(",")) {
    const trimmed = raw.trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) txHashes.add(trimmed as Hash);
  }

  const dbPath = process.env.DATABASE_URL?.trim() || "file:./apps/web/data/vire.db";
  try {
    const client = createClient({
      url: dbPath,
      authToken: process.env.DATABASE_AUTH_TOKEN?.trim() || undefined,
    });
    const rows = await client
      .execute("SELECT vault_release_tx_hash, textile_swap_tx_hash, payout_tx_hash FROM settlements ORDER BY settled_at DESC LIMIT 3")
      .catch(() => null);
    for (const row of rows?.rows ?? []) {
      for (const field of ["vault_release_tx_hash", "textile_swap_tx_hash", "payout_tx_hash"]) {
        const val = row[field];
        if (typeof val === "string" && /^0x[0-9a-fA-F]{64}$/.test(val)) {
          txHashes.add(val as Hash);
        }
      }
    }
  } catch {
    // No local DB settlements yet
  }

  if (txHashes.size === 0) {
    record(
      "erc8021",
      "Onchain Settlement verifyTx()",
      "WARN",
      "No settled mainnet hashes recorded yet. Pass --tx=0x... or complete a settlement to verify onchain tags."
    );
  } else {
    for (const hash of txHashes) {
      try {
        const res = await verifyAttributionTx({ publicClient, hash });
        const hasVire = res.codes.includes(attributionCode);
        record(
          "erc8021",
          `verifyTx(${hash.slice(0, 12)}…)`,
          res.tagged && hasVire ? "PASS" : "FAIL",
          `tagged=${res.tagged}, codes=[${res.codes.join(", ")}], schema=${res.schemaId}`
        );
      } catch (err) {
        record("erc8021", `verifyTx(${hash.slice(0, 12)}…)`, "FAIL", err instanceof Error ? err.message : String(err));
      }
    }
  }

  // Final Summary
  const fails = results.filter((r) => r.status === "FAIL").length;
  const warns = results.filter((r) => r.status === "WARN").length;
  const passes = results.filter((r) => r.status === "PASS").length;

  console.log("\n========================================================================");
  console.log(`  DOCTOR SUMMARY: ${passes} PASS · ${warns} WARN · ${fails} FAIL`);
  console.log("========================================================================");

  if (fails > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Doctor fatal error:", err);
  process.exit(1);
});

import {
  createCeloPublicClient,
  createTaggedWalletClient,
  registerAgentIdentity,
} from "@vire/celo-infra";
import {
  CELO_MAINNET_CHAIN_ID,
  celoscanTxUrl,
  DEFAULT_ATTRIBUTION_CODE,
  DEFAULT_CELO_RPC_URL,
  validateAttributionCode,
} from "@vire/shared";
import type { Hex } from "viem";
import { loadDotEnv } from "./load-env.js";

loadDotEnv();

async function main() {
  const pk = process.env.VIRE_AGENT_PRIVATE_KEY?.trim();
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("VIRE_AGENT_PRIVATE_KEY (0x + 64 hex chars) is required in .env");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl || !appUrl.startsWith("https://")) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL must be your public HTTPS deployment URL before registering ERC-8004 identity (e.g. https://vire.yourdomain.com)"
    );
  }

  const agentUri = `${appUrl.replace(/\/+$/, "")}/api/agent-card.json`;
  const rpcUrl = process.env.CELO_RPC_URL?.trim() || DEFAULT_CELO_RPC_URL;
  const attributionCode = validateAttributionCode(
    process.env.VIRE_ATTRIBUTION_CODE || DEFAULT_ATTRIBUTION_CODE
  );
  const useUsdtFeeAbstraction = process.env.VIRE_USE_USDT_FEE_ABSTRACTION === "true";

  const publicClient = createCeloPublicClient({ rpcUrl, chainId: CELO_MAINNET_CHAIN_ID });
  const walletClient = createTaggedWalletClient({
    privateKey: pk as Hex,
    attributionCode,
    rpcUrl,
    chainId: CELO_MAINNET_CHAIN_ID,
  });

  console.log("Registering Vire on Celo Mainnet ERC-8004 Identity Registry...");
  console.log("  Agent Wallet:", walletClient.account.address);
  console.log("  Agent URI:   ", agentUri);
  console.log("  ERC-8021 Tag:", attributionCode);
  console.log("  CIP-64 USD₮: ", useUsdtFeeAbstraction);

  const result = await registerAgentIdentity({
    walletClient,
    publicClient,
    agentUri,
    attributionCode,
    useUsdtFeeAbstraction,
  });

  console.log("\nERC-8004 Registration Confirmed on Celo Mainnet!");
  console.log("  agentId:  ", result.agentId.toString());
  console.log("  owner:    ", result.owner);
  console.log("  txHash:   ", result.txHash);
  console.log("  Celoscan: ", celoscanTxUrl(result.txHash));
  console.log(`\nNext step: add this to your .env and redeploy so /api/agent-card.json includes your registration:\n  VIRE_AGENT_ID=${result.agentId.toString()}`);
}

main().catch((err) => {
  console.error("ERC-8004 registration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

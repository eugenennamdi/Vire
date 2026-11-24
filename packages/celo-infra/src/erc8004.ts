import {
  CELO_CONTRACTS,
  CELO_MAINNET_CHAIN_ID,
  CORRIDORS,
  PRIMARY_CORRIDORS,
} from "@vire/shared";
import {
  encodeFunctionData,
  formatUnits,
  parseEventLogs,
  zeroHash,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { sendTaggedTx } from "./tagged-tx.js";

export const ERC8004_IDENTITY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setAgentURI",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

export const ERC8004_REPUTATION_ABI = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    outputs: [],
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "getClients",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "getSummary",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clients", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
    ],
  },
] as const;

export const VIRE_REPUTATION_TAG = "settlement" as const;

export interface AgentRegistrationManifest {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
  name: string;
  description: string;
  image: string;
  services: Array<{ name: string; endpoint: string; version?: string }>;
  x402Support: true;
  active: true;
  supportedTrust: string[];
  vire: {
    chainId: number;
    vaultAddress: string | null;
    corridors: string[];
    textileReactor: string;
  };
  registrations?: Array<{
    agentId: number;
    agentRegistry: string;
  }>;
}

export function buildAgentCardManifest(params: {
  appUrl: string;
  vaultAddress?: string;
  agentId?: number | bigint;
}): AgentRegistrationManifest {
  const base = params.appUrl.replace(/\/+$/, "");
  const manifest: AgentRegistrationManifest = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Vire — Autonomous Proof-of-Work & Multi-Corridor FX Settlement Agent",
    description:
      "Autonomous proof-of-work and commission clearing agent on Celo Mainnet. Verifies off-chain deliverables via Celo buy, converts exact-output USD₮ into cNGN, wARS, wBRL, wMXN, and IDRX on Textile FX, and settles directly to external contributors.",
    image: `${base}/icon-512.png`,
    services: [
      { name: "web", endpoint: base },
      { name: "x402-verify", endpoint: `${base}/api/x402/verify`, version: "2.0" },
      { name: "x402-campaigns", endpoint: `${base}/api/x402/campaigns`, version: "2.0" },
      { name: "ledger", endpoint: `${base}/api/ledger` },
    ],
    x402Support: true,
    active: true,
    supportedTrust: ["reputation"],
    vire: {
      chainId: CELO_MAINNET_CHAIN_ID,
      vaultAddress: params.vaultAddress || null,
      corridors: PRIMARY_CORRIDORS.map((c) => `${CORRIDORS[c].symbol} (${CORRIDORS[c].countryCode})`),
      textileReactor: CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR,
    },
  };

  if (params.agentId !== undefined && Number(params.agentId) > 0) {
    manifest.registrations = [
      {
        agentId: Number(params.agentId),
        agentRegistry: `eip155:${CELO_MAINNET_CHAIN_ID}:${CELO_CONTRACTS.ERC8004_IDENTITY_REGISTRY}`,
      },
    ];
  }

  return manifest;
}

/**
 * Register Vire on Celo Mainnet's ERC-8004 Identity Registry via a tagged transaction.
 * Parses `agentId` strictly from the mined `Registered` event log (never simulation return value).
 */
export async function registerAgentIdentity(params: {
  walletClient: WalletClient<Transport, Chain, Account>;
  publicClient: PublicClient<Transport, Chain>;
  agentUri: string;
  attributionCode?: string;
  useUsdtFeeAbstraction?: boolean;
}): Promise<{ agentId: bigint; txHash: Hash; owner: Address }> {
  const calldata = encodeFunctionData({
    abi: ERC8004_IDENTITY_ABI,
    functionName: "register",
    args: [params.agentUri],
  });

  const { hash } = await sendTaggedTx({
    walletClient: params.walletClient,
    publicClient: params.publicClient,
    to: CELO_CONTRACTS.ERC8004_IDENTITY_REGISTRY,
    data: calldata,
    attributionCode: params.attributionCode,
    useUsdtFeeAbstraction: params.useUsdtFeeAbstraction,
  });

  const receipt = await params.publicClient.waitForTransactionReceipt({ hash });
  const events = parseEventLogs({
    abi: ERC8004_IDENTITY_ABI,
    eventName: "Registered",
    logs: receipt.logs,
  });

  const first = events[0];
  if (!first) {
    throw new Error(`ERC-8004 Registered event not found in receipt ${hash}`);
  }

  return {
    agentId: first.args.agentId,
    txHash: hash,
    owner: first.args.owner,
  };
}

export async function getAgentIdentity(params: {
  publicClient: PublicClient<Transport, Chain>;
  agentId: bigint;
}): Promise<{ agentId: bigint; owner: Address; agentUri: string }> {
  const [owner, agentUri] = await Promise.all([
    params.publicClient.readContract({
      address: CELO_CONTRACTS.ERC8004_IDENTITY_REGISTRY,
      abi: ERC8004_IDENTITY_ABI,
      functionName: "ownerOf",
      args: [params.agentId],
    }),
    params.publicClient.readContract({
      address: CELO_CONTRACTS.ERC8004_IDENTITY_REGISTRY,
      abi: ERC8004_IDENTITY_ABI,
      functionName: "tokenURI",
      args: [params.agentId],
    }),
  ]);

  return { agentId: params.agentId, owner, agentUri };
}

export interface ReputationSummary {
  agentId: string;
  tag: string;
  clientCount: number;
  feedbackCount: number;
  averageScore: string | null;
  rawValue: string | null;
  valueDecimals: number;
}

/**
 * Query Vire's ERC-8004 Reputation Registry summary with tag="settlement".
 * Guards against empty `clients` array (getSummary reverts with "clientAddresses required" when empty).
 */
export async function getReputationSummary(params: {
  publicClient: PublicClient<Transport, Chain>;
  agentId: bigint;
  tag?: string;
  trustedClients?: Address[];
}): Promise<ReputationSummary> {
  const tag = params.tag ?? VIRE_REPUTATION_TAG;
  const clients =
    params.trustedClients ??
    (await params.publicClient.readContract({
      address: CELO_CONTRACTS.ERC8004_REPUTATION_REGISTRY,
      abi: ERC8004_REPUTATION_ABI,
      functionName: "getClients",
      args: [params.agentId],
    }));

  if (clients.length === 0) {
    return {
      agentId: params.agentId.toString(),
      tag,
      clientCount: 0,
      feedbackCount: 0,
      averageScore: null,
      rawValue: null,
      valueDecimals: 0,
    };
  }

  const [count, value, valueDecimals] = await params.publicClient.readContract({
    address: CELO_CONTRACTS.ERC8004_REPUTATION_REGISTRY,
    abi: ERC8004_REPUTATION_ABI,
    functionName: "getSummary",
    args: [params.agentId, [...clients], tag, ""],
  });

  if (count === 0n) {
    return {
      agentId: params.agentId.toString(),
      tag,
      clientCount: clients.length,
      feedbackCount: 0,
      averageScore: null,
      rawValue: null,
      valueDecimals,
    };
  }

  return {
    agentId: params.agentId.toString(),
    tag,
    clientCount: clients.length,
    feedbackCount: Number(count),
    averageScore: formatUnits(value, valueDecimals),
    rawValue: value.toString(),
    valueDecimals,
  };
}

/** Build unsigned calldata for contributor 1-click "Rate Vire Onchain (ERC-8004)" button. */
export function buildGiveFeedbackCall(params: {
  agentId: bigint;
  score: number; // 0..100
  endpoint: string;
  corridorTag?: string;
}): { to: Address; data: Hex; args: readonly [bigint, bigint, number, string, string, string, string, Hex] } {
  const clampedScore = Math.max(0, Math.min(100, Math.round(params.score)));
  const args = [
    params.agentId,
    BigInt(clampedScore),
    0,
    VIRE_REPUTATION_TAG,
    params.corridorTag ?? "",
    params.endpoint,
    "",
    zeroHash,
  ] as const;

  const data = encodeFunctionData({
    abi: ERC8004_REPUTATION_ABI,
    functionName: "giveFeedback",
    args,
  });

  return {
    to: CELO_CONTRACTS.ERC8004_REPUTATION_REGISTRY,
    data,
    args,
  };
}

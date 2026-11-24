import { randomUUID } from "node:crypto";
import { parseX402PaymentResponseHeader } from "@vire/celo-infra";
import { CELO_TOKENS, DEFAULT_X402_FACILITATOR_URL } from "@vire/shared";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { withX402 } from "@x402/next";
import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress, type Address } from "viem";
import { ensureDatabaseReady, getDb, schema } from "@/db";
import { getAgentAddress } from "./runtime";
import { buildCeloX402RouteConfig, CELO_MAINNET_CAIP2 } from "./x402-config";

export { buildCeloX402RouteConfig, CELO_MAINNET_CAIP2 };

export function getX402PayToAddress(): Address | null {
  const configured = process.env.VIRE_X402_PAY_TO?.trim();
  if (configured && isAddress(configured)) {
    return getAddress(configured);
  }
  return getAgentAddress();
}

export function getX402FacilitatorUrl(): string {
  return (process.env.X402_FACILITATOR_URL?.trim() || DEFAULT_X402_FACILITATOR_URL).replace(/\/+$/, "");
}

let _resourceServer: x402ResourceServer | null = null;
let _resourceServerInit: Promise<void> | null = null;

export function getX402ResourceServer(): x402ResourceServer {
  if (!_resourceServer) {
    const apiKey = process.env.X402_API_KEY?.trim();
    const facilitator = new HTTPFacilitatorClient({
      url: getX402FacilitatorUrl(),
      createAuthHeaders: async () => {
        if (!apiKey) {
          return { verify: {}, settle: {}, supported: {} };
        }
        const h = { "X-API-Key": apiKey };
        return { verify: h, settle: h, supported: h };
      },
    });
    _resourceServer = new x402ResourceServer(facilitator).register(
      "eip155:*",
      new ExactEvmScheme()
    );
  }
  return _resourceServer;
}

async function getInitializedX402ResourceServer(): Promise<x402ResourceServer> {
  const server = getX402ResourceServer();
  if (!_resourceServerInit) {
    _resourceServerInit = server.initialize().catch((err) => {
      _resourceServerInit = null;
      throw err;
    });
  }
  await _resourceServerInit;
  return server;
}

/**
 * Execute a Next.js route handler wrapped with official `@x402/next` `withX402` protection
 * and log every settled x402 payment into the public `x402_inflows` audit ledger.
 */
export async function executeX402ProtectedRoute(params: {
  req: NextRequest;
  routePath: string;
  usdtAtomicAmount: string;
  description: string;
  handler: (req: NextRequest) => Promise<NextResponse>;
  onSettled?: (txHash: string, response: NextResponse) => Promise<void>;
}): Promise<NextResponse> {
  const payTo = getX402PayToAddress();
  if (!payTo) {
    return NextResponse.json(
      {
        error: "VIRE_X402_PAY_TO is not configured. Set VIRE_X402_PAY_TO in .env to enable x402 settlement.",
      },
      { status: 503 }
    );
  }

  const cngnOnly = params.req.nextUrl.searchParams.get("asset")?.toLowerCase() === "cngn";
  const routeConfig = buildCeloX402RouteConfig({
    payTo,
    usdtAtomicAmount: params.usdtAtomicAmount,
    description: params.description,
    cngnOnly,
  });

  const server = await getInitializedX402ResourceServer();
  const wrapped = withX402(
    params.handler,
    { [params.routePath]: routeConfig },
    server,
    undefined,
    undefined,
    false
  );

  const response = await wrapped(params.req);

  if (response.status >= 200 && response.status < 300) {
    const header =
      response.headers.get("payment-response") ?? response.headers.get("x-payment-response");
    const settled = parseX402PaymentResponseHeader(header);
    if (settled.txHash) {
      await ensureDatabaseReady();
      const db = getDb();
      const raw = settled.raw ?? {};
      const extra = (raw.extra as Record<string, unknown> | undefined) ?? {};
      const assetAddr =
        typeof raw.asset === "string"
          ? raw.asset
          : cngnOnly
            ? CELO_TOKENS.cNGN.address
            : CELO_TOKENS.USDT.address;
      const tokenInfo = Object.values(CELO_TOKENS).find(
        (t) => t.address.toLowerCase() === assetAddr.toLowerCase()
      );

      await db.insert(schema.x402Inflows).values({
        id: `x402_${randomUUID()}`,
        endpoint: params.routePath,
        payerWallet: (settled.payer ?? "unknown").toLowerCase(),
        payToWallet: payTo.toLowerCase(),
        assetAddress: assetAddr,
        assetSymbol: tokenInfo?.symbol ?? (cngnOnly ? "cNGN" : "USDT"),
        amountAtomic: typeof raw.amount === "string" ? raw.amount : params.usdtAtomicAmount,
        settlementTxHash: settled.txHash,
        blockNumber: typeof extra.blockNumber === "number" ? extra.blockNumber : null,
        metadataJson: JSON.stringify(raw),
        createdAt: Date.now(),
      });
      if (params.onSettled) {
        await params.onSettled(settled.txHash, response);
      }
    }
  }

  return response;
}

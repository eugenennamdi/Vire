import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Audit Ledger",
  description:
    "Public onchain settlement ledger indexing Textile FX swaps, VireVault releases, Policy Gate rejections, x402 verification calls, and inflows on Celo Mainnet.",
  alternates: { canonical: "/ledger" },
};

export default function LedgerLayout({ children }: { children: ReactNode }) {
  return children;
}

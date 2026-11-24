import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Console & x402 Playground",
  description:
    "Inspect live VireVault custody parameters, canonical Celo Mainnet token decimals, and test HTTP 402 payment challenges on api.x402.celo.org.",
  alternates: { canonical: "/console" },
};

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return children;
}

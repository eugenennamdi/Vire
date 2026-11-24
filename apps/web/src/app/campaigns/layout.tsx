import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Campaigns",
  description:
    "Browse active multi-stage work campaigns settled in exact cNGN, wARS, wBRL, wMXN, and IDRX via Textile FX and VireVault on Celo Mainnet.",
  alternates: { canonical: "/campaigns" },
};

export default function CampaignsLayout({ children }: { children: ReactNode }) {
  return children;
}

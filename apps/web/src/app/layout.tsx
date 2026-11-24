import { CELO_CONTRACTS, celoscanAddressUrl, DEFAULT_ATTRIBUTION_CODE } from "@vire/shared";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { Navbar } from "@/components/navbar";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vire — Proof-of-Work & FX Clearing on Celo",
  description:
    "Verify off-chain deliverables, enforce onchain vault limits, and settle exact local stablecoins (cNGN, wARS, wBRL, wMXN, IDRX) on Celo Mainnet.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const attributionCode = process.env.VIRE_ATTRIBUTION_CODE || DEFAULT_ATTRIBUTION_CODE;
  const vaultAddress = process.env.VIRE_VAULT_ADDRESS?.trim();
  const agentId = process.env.VIRE_AGENT_ID?.trim();

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-[100dvh] bg-white font-sans text-[#111111] antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[#111111] focus:px-3 focus:py-2 focus:text-xs focus:font-medium focus:text-white"
        >
          Skip to content
        </a>

        <Providers>
          <div className="flex min-h-[100dvh] flex-col">
            <Navbar />
            <main
              id="main-content"
              className="mx-auto w-full max-w-[1160px] flex-1 px-4 pb-20 pt-10 sm:px-6 lg:px-8"
            >
              {children}
            </main>

            <footer className="border-t border-[#E5E5E5] bg-white">
              <div className="mx-auto flex max-w-[1160px] flex-col items-start justify-between gap-3 px-4 py-6 font-mono text-[11px] text-[#737373] sm:flex-row sm:items-center sm:px-6 lg:px-8">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <span className="font-medium text-[#111111]">Vire</span>
                  <span>Celo 42220</span>
                  <span>{attributionCode}</span>
                  {vaultAddress && (
                    <a
                      href={celoscanAddressUrl(vaultAddress)}
                      target="_blank"
                      rel="noreferrer"
                      className="transition-colors hover:text-[#111111]"
                    >
                      VireVault
                    </a>
                  )}
                  <a
                    href={celoscanAddressUrl(CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR)}
                    target="_blank"
                    rel="noreferrer"
                    className="transition-colors hover:text-[#111111]"
                  >
                    Textile
                  </a>
                  <a
                    href={celoscanAddressUrl(CELO_CONTRACTS.ERC8004_IDENTITY_REGISTRY)}
                    target="_blank"
                    rel="noreferrer"
                    className="transition-colors hover:text-[#111111]"
                  >
                    ERC-8004{agentId ? ` #${agentId}` : ""}
                  </a>
                </div>

                <div className="flex items-center gap-4">
                  <Link
                    href="/api/agent-card.json"
                    className="transition-colors hover:text-[#111111]"
                  >
                    agent-card.json
                  </Link>
                  <a
                    href="https://github.com/eugenennamdi/Vire"
                    target="_blank"
                    rel="noreferrer"
                    className="transition-colors hover:text-[#111111]"
                  >
                    GitHub
                  </a>
                </div>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}

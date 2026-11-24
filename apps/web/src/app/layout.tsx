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
  title: "Vire — Autonomous Proof-of-Work & FX Clearing on Celo",
  description:
    "Autonomous proof-of-work verification, exact-output Textile FX stablecoin settlement (cNGN, wARS, wBRL, wMXN, IDRX), and policy-guarded USD₮ treasury clearing on Celo Mainnet.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const attributionCode = process.env.VIRE_ATTRIBUTION_CODE || DEFAULT_ATTRIBUTION_CODE;
  const vaultAddress = process.env.VIRE_VAULT_ADDRESS?.trim();
  const agentId = process.env.VIRE_AGENT_ID?.trim();

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark`}>
      <body className="vire-ambient-backdrop min-h-[100dvh] bg-[#08090A] font-sans text-[#F4F5F6] antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[#F4F5F6] focus:px-3 focus:py-2 focus:text-xs focus:font-medium focus:text-[#08090A]"
        >
          Skip to content
        </a>

        <Providers>
          <div className="flex min-h-[100dvh] flex-col">
            <Navbar />
            <main
              id="main-content"
              className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-16 pt-8 sm:px-6 lg:px-8"
            >
              {children}
            </main>

            <footer className="border-t border-white/[0.07] bg-[#08090A]">
              <div className="mx-auto flex max-w-[1280px] flex-col items-start justify-between gap-4 px-4 py-6 text-xs text-[#6B7280] sm:flex-row sm:items-center sm:px-6 lg:px-8">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px]">
                  <span className="font-medium text-[#D5D8DE]">Vire Clearing · Celo 42220</span>
                  <span className="text-[#8A8F98]">ERC-8021 {attributionCode}</span>
                  {vaultAddress && (
                    <a
                      href={celoscanAddressUrl(vaultAddress)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#8A8F98] transition-colors hover:text-[#F4F5F6]"
                    >
                      VireVault
                    </a>
                  )}
                  <a
                    href={celoscanAddressUrl(CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#8A8F98] transition-colors hover:text-[#F4F5F6]"
                  >
                    Textile Reactor
                  </a>
                  <a
                    href={celoscanAddressUrl(CELO_CONTRACTS.ERC8004_IDENTITY_REGISTRY)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#8A8F98] transition-colors hover:text-[#F4F5F6]"
                  >
                    ERC-8004{agentId ? ` #${agentId}` : ""}
                  </a>
                  <Link
                    href="/api/agent-card.json"
                    className="text-[#8A8F98] transition-colors hover:text-[#F4F5F6]"
                  >
                    agent-card.json
                  </Link>
                </div>

                <div className="flex items-center gap-4 text-[11px] text-[#5C626D]">
                  <span>Non-custodial USD₮ vault</span>
                  <span aria-hidden="true">·</span>
                  <span>Exact-output FX</span>
                  <span aria-hidden="true">·</span>
                  <a
                    href="https://github.com/eugenennamdi/Vire"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#8A8F98] transition-colors hover:text-[#F4F5F6]"
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

import { CELO_CONTRACTS, celoscanAddressUrl, DEFAULT_ATTRIBUTION_CODE } from "@vire/shared";
import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Navbar } from "@/components/navbar";
import { Providers } from "@/components/providers";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Vire — Autonomous Proof-of-Work & Multi-Corridor FX Settlement Agent",
  description:
    "Autonomous proof-of-work verification, Textile FX exact-output stablecoin settlement (cNGN, wARS, wBRL, wMXN, IDRX), and policy-guarded USD₮ treasury clearing on Celo Mainnet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const attributionCode = process.env.VIRE_ATTRIBUTION_CODE || DEFAULT_ATTRIBUTION_CODE;

  return (
    <html lang="en" className={`${ibmPlexSans.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Navbar />
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
              {children}
            </main>
            <footer className="border-t border-zinc-200/80 bg-white">
              <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-3 px-4 py-5 text-xs text-zinc-500 sm:flex-row sm:items-center sm:px-6 lg:px-8">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono">
                  <span className="font-semibold text-zinc-900">Vire Clearing · Celo Mainnet (42220)</span>
                  <span>ERC-8021: {attributionCode}</span>
                  <a
                    href={celoscanAddressUrl(CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR)}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
                  >
                    Textile Reactor
                  </a>
                  <a
                    href={celoscanAddressUrl(CELO_CONTRACTS.ERC8004_IDENTITY_REGISTRY)}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
                  >
                    ERC-8004 Registry
                  </a>
                  <a
                    href="/api/agent-card.json"
                    className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
                  >
                    agent-card.json
                  </a>
                </div>
                <span className="text-[11px] text-zinc-400">
                  Non-custodial settlement · Exact-output FX · External contributors only
                </span>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}

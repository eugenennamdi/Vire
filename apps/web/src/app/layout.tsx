import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { CELO_CONTRACTS, celoscanAddressUrl, DEFAULT_ATTRIBUTION_CODE } from "@vire/shared";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { VireMark } from "@/components/brand/vire-mark";
import { Navbar } from "@/components/navbar";
import { Providers } from "@/components/providers";
import { TokenIcon } from "@/components/ui/token-icon";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist-mono",
  display: "swap",
});

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://usevire.xyz").replace(/\/+$/, "");
const SITE_NAME = "Vire";
const DEFAULT_TITLE = "Vire — Proof-of-Work & Exact Local FX Clearing on Celo";
const DEFAULT_DESCRIPTION =
  "Verify off-chain deliverables, enforce onchain VireVault limits, and settle exact local stablecoins (cNGN, wARS, wBRL, wMXN, IDRX) via Textile FX on Celo Mainnet.";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f5f7",
  colorScheme: "light",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: "%s — Vire",
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  category: "finance",
  referrer: "origin-when-cross-origin",
  keywords: [
    "Vire",
    "Celo Mainnet",
    "Textile FX",
    "stablecoin clearing",
    "proof of work payout",
    "cNGN",
    "wARS",
    "wBRL",
    "wMXN",
    "IDRX",
    "USDT",
    "x402",
    "ERC-8004",
    "ERC-8021",
  ],
  authors: [{ name: "Vire", url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  alternates: {
    canonical: "/",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.ico" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Vire — Verify work. Settle exact local FX on Celo Mainnet.",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Vire — Verify work. Settle exact local FX on Celo Mainnet.",
      },
    ],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

const FOOTER_RAILS = [
  { symbol: "cNGN", label: "cNGN · Nigeria" },
  { symbol: "wARS", label: "wARS · Argentina" },
  { symbol: "wBRL", label: "wBRL · Brazil" },
  { symbol: "IDRX", label: "IDRX · Indonesia" },
  { symbol: "wMXN", label: "wMXN · Mexico" },
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  const attributionCode = process.env.VIRE_ATTRIBUTION_CODE || DEFAULT_ATTRIBUTION_CODE;
  const vaultAddress = process.env.VIRE_VAULT_ADDRESS?.trim();
  const agentId = process.env.VIRE_AGENT_ID?.trim();

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: {
          "@type": "ImageObject",
          url: `${SITE_URL}/icon-512.png`,
          width: 512,
          height: 512,
        },
        sameAs: ["https://github.com/eugenennamdi/Vire"],
      },
      {
        "@type": "WebApplication",
        "@id": `${SITE_URL}/#webapp`,
        name: SITE_NAME,
        url: SITE_URL,
        description: DEFAULT_DESCRIPTION,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-[100dvh] bg-[#F5F5F7] font-sans text-[#0A0A0C] antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />

        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[#0A0A0C] focus:px-4 focus:py-2 focus:text-xs focus:font-medium focus:text-white"
        >
          Skip to content
        </a>

        <Providers>
          <div className="flex min-h-[100dvh] flex-col">
            <Navbar />
            <main
              id="main-content"
              className="mx-auto w-full max-w-[1220px] flex-1 px-4 pb-24 pt-8 sm:px-6 lg:px-8"
            >
              {children}
            </main>

            <footer className="border-t border-black/[0.06] bg-white">
              <div className="mx-auto max-w-[1220px] px-4 py-12 sm:px-6 lg:px-8">
                <div className="grid grid-cols-2 gap-10 border-b border-black/[0.06] pb-10 md:grid-cols-12">
                  <div className="col-span-2 space-y-3 md:col-span-5">
                    <Link
                      href="/"
                      className="inline-flex items-center gap-2 text-[14.5px] font-semibold tracking-[-0.025em] text-[#0A0A0C]"
                    >
                      <VireMark variant="badge" size={22} />
                      <span>Vire</span>
                    </Link>
                    <p className="max-w-xs text-[13px] leading-[1.6] text-[#71717A]">
                      Automated work verification, onchain spending limits, and exact local-currency
                      payouts on Celo Mainnet.
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[12px] text-[#71717A]">
                      <a
                        href="https://github.com/eugenennamdi/Vire"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 transition-colors hover:text-[#0A0A0C]"
                      >
                        GitHub <ArrowUpRight className="h-3 w-3" />
                      </a>
                      <Link
                        href="/api/agent-card.json"
                        className="inline-flex items-center gap-1 transition-colors hover:text-[#0A0A0C]"
                      >
                        agent-card.json <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>

                  <nav aria-label="Protocol" className="space-y-3 md:col-span-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#A1A1AA]">
                      Protocol
                    </div>
                    <ul className="space-y-2 text-[13px] text-[#52525B]">
                      <li>
                        <Link href="/" className="transition-colors hover:text-[#0A0A0C]">
                          Overview
                        </Link>
                      </li>
                      <li>
                        <Link href="/campaigns" className="transition-colors hover:text-[#0A0A0C]">
                          Campaigns
                        </Link>
                      </li>
                      <li>
                        <Link href="/claim" className="transition-colors hover:text-[#0A0A0C]">
                          Submit work
                        </Link>
                      </li>
                      <li>
                        <Link href="/ledger" className="transition-colors hover:text-[#0A0A0C]">
                          Public ledger
                        </Link>
                      </li>
                      <li>
                        <Link href="/console" className="transition-colors hover:text-[#0A0A0C]">
                          Developer console
                        </Link>
                      </li>
                    </ul>
                  </nav>

                  <nav aria-label="Contracts" className="space-y-3 md:col-span-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#A1A1AA]">
                      Onchain
                    </div>
                    <ul className="space-y-2 text-[13px] text-[#52525B]">
                      {vaultAddress && (
                        <li>
                          <a
                            href={celoscanAddressUrl(vaultAddress)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 transition-colors hover:text-[#0A0A0C]"
                          >
                            VireVault <ArrowUpRight className="h-3 w-3" />
                          </a>
                        </li>
                      )}
                      <li>
                        <a
                          href={celoscanAddressUrl(CELO_CONTRACTS.TEXTILE_LIMIT_ORDER_REACTOR)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 transition-colors hover:text-[#0A0A0C]"
                        >
                          Textile FX Reactor <ArrowUpRight className="h-3 w-3" />
                        </a>
                      </li>
                      <li>
                        <a
                          href={celoscanAddressUrl(CELO_CONTRACTS.ERC8004_IDENTITY_REGISTRY)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 transition-colors hover:text-[#0A0A0C]"
                        >
                          ERC-8004{agentId ? ` #${agentId}` : ""} <ArrowUpRight className="h-3 w-3" />
                        </a>
                      </li>
                      <li>
                        <a
                          href="/api/corridors/live"
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 transition-colors hover:text-[#0A0A0C]"
                        >
                          Live FX JSON <ArrowUpRight className="h-3 w-3" />
                        </a>
                      </li>
                    </ul>
                  </nav>

                  <div className="space-y-3 md:col-span-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#A1A1AA]">
                      Currencies
                    </div>
                    <ul className="space-y-2 whitespace-nowrap font-mono text-[11.5px] text-[#52525B]">
                      {FOOTER_RAILS.map((r) => (
                        <li key={r.symbol} className="flex items-center gap-2">
                          <TokenIcon symbol={r.symbol} size={15} />
                          <span>{r.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="flex flex-col items-start justify-between gap-2 pt-6 font-mono text-[11.5px] text-[#71717A] sm:flex-row sm:items-center">
                  <span>
                    Owner-controlled USDT treasury · Attribution{" "}
                    <span className="text-[#0A0A0C]">{attributionCode}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <TokenIcon symbol="CELO" size={14} />
                    Celo Mainnet
                  </span>
                </div>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}

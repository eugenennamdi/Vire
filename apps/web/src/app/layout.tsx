import { CELO_CONTRACTS, celoscanAddressUrl, DEFAULT_ATTRIBUTION_CODE } from "@vire/shared";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { VireMark } from "@/components/brand/vire-mark";
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

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://usevire.xyz").replace(/\/+$/, "");
const SITE_NAME = "Vire";
const DEFAULT_TITLE = "Vire — Proof-of-Work & Exact Local FX Clearing on Celo";
const DEFAULT_DESCRIPTION =
  "Verify off-chain deliverables, enforce onchain VireVault limits, and settle exact local stablecoins (cNGN, wARS, wBRL, wMXN, IDRX) via Textile FX on Celo Mainnet.";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
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
    "USD₮",
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
      <body className="min-h-[100dvh] bg-white font-sans text-[#111111] antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />

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
                  <span className="inline-flex items-center gap-1.5 font-medium text-[#111111]">
                    <VireMark variant="bare" size={14} />
                    Vire
                  </span>
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

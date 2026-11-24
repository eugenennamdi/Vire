"use client";

import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import { createConfig as createPrivyWagmiConfig, WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { createConfig, http, injected, WagmiProvider } from "wagmi";
import { celo } from "wagmi/chains";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || "";

export const wagmiConfig = PRIVY_APP_ID
  ? createPrivyWagmiConfig({
      chains: [celo],
      transports: {
        [celo.id]: http("https://forno.celo.org"),
      },
      ssr: true,
    })
  : createConfig({
      chains: [celo],
      connectors: [injected()],
      transports: {
        [celo.id]: http("https://forno.celo.org"),
      },
      ssr: true,
    });

const PRIVY_CONFIG: PrivyClientConfig = {
  appearance: {
    theme: "light",
    accentColor: "#0A0A0C",
    logo: "/icon.svg",
    landingHeader: "Sign in to Vire",
    loginMessage: "Sign in with Google, email, or a Celo wallet to verify work and get paid.",
    walletChainType: "ethereum-only",
    showWalletLoginFirst: false,
  },
  defaultChain: celo,
  supportedChains: [celo],
  embeddedWallets: {
    ethereum: {
      createOnLogin: "users-without-wallets",
    },
  },
};

function AppToaster() {
  return (
    <Toaster
      theme="light"
      position="bottom-right"
      toastOptions={{
        style: {
          background: "#FFFFFF",
          border: "1px solid rgba(10, 10, 12, 0.09)",
          color: "#0A0A0C",
          fontSize: "13px",
          borderRadius: "12px",
          boxShadow: "0 8px 24px -8px rgba(10, 10, 12, 0.14)",
        },
      }}
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  if (!PRIVY_APP_ID) {
    return (
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          {children}
          <AppToaster />
        </QueryClientProvider>
      </WagmiProvider>
    );
  }

  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={PRIVY_CONFIG}>
      <QueryClientProvider client={queryClient}>
        <PrivyWagmiProvider config={wagmiConfig}>
          {children}
          <AppToaster />
        </PrivyWagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}

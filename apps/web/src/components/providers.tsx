"use client";

import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import { createConfig as createPrivyWagmiConfig, WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { createConfig, http, injected, useAccount, useConnect, WagmiProvider } from "wagmi";
import { celo } from "wagmi/chains";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || "";

const MiniPayContext = createContext(false);

/** True when opened inside Opera MiniPay's native Celo mobile browser (`window.ethereum.isMiniPay`). */
export function useIsMiniPay(): boolean {
  return useContext(MiniPayContext);
}

export const injectedWagmiConfig = createConfig({
  chains: [celo],
  connectors: [injected()],
  transports: {
    [celo.id]: http("https://forno.celo.org"),
  },
  ssr: true,
});

export const wagmiConfig = PRIVY_APP_ID
  ? createPrivyWagmiConfig({
      chains: [celo],
      transports: {
        [celo.id]: http("https://forno.celo.org"),
      },
      ssr: true,
    })
  : injectedWagmiConfig;

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

function MiniPayAutoConnect() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  useEffect(() => {
    if (isConnected) return;
    const connector = connectors[0];
    if (connector) {
      connect({ connector });
    }
  }, [isConnected, connect, connectors]);

  return null;
}

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
  const [isMiniPay, setIsMiniPay] = useState(false);
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

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      Boolean((window as { ethereum?: { isMiniPay?: boolean } }).ethereum?.isMiniPay)
    ) {
      setIsMiniPay(true);
    }
  }, []);

  // Native MiniPay fast-path (and fallback when Privy isn't configured):
  // bypasses Privy's modal completely so MiniPay users auto-connect directly to Celo Mainnet.
  if (!PRIVY_APP_ID || isMiniPay) {
    return (
      <MiniPayContext.Provider value={isMiniPay}>
        <WagmiProvider config={injectedWagmiConfig}>
          <QueryClientProvider client={queryClient}>
            {isMiniPay && <MiniPayAutoConnect />}
            {children}
            <AppToaster />
          </QueryClientProvider>
        </WagmiProvider>
      </MiniPayContext.Provider>
    );
  }

  return (
    <MiniPayContext.Provider value={false}>
      <PrivyProvider appId={PRIVY_APP_ID} config={PRIVY_CONFIG}>
        <QueryClientProvider client={queryClient}>
          <PrivyWagmiProvider config={wagmiConfig}>
            {children}
            <AppToaster />
          </PrivyWagmiProvider>
        </QueryClientProvider>
      </PrivyProvider>
    </MiniPayContext.Provider>
  );
}

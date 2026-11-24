"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { createConfig, http, injected, WagmiProvider, type Config } from "wagmi";
import { celo } from "wagmi/chains";

export const wagmiConfig: Config = createConfig({
  chains: [celo],
  connectors: [injected()],
  transports: {
    [celo.id]: http("https://forno.celo.org"),
  },
  ssr: true,
});

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

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster
          theme="light"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#FFFFFF",
              border: "1px solid #E5E5E5",
              color: "#111111",
              fontSize: "13px",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
            },
          }}
        />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

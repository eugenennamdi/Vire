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
              border: "1px solid #D5D2C9",
              color: "#121210",
              fontSize: "13px",
              borderRadius: "6px",
              boxShadow: "0 2px 10px rgba(18, 18, 16, 0.06)",
            },
          }}
        />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

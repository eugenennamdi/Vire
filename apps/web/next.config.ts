import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@vire/shared", "@vire/celo-infra", "@vire/textile", "@vire/agent"],
  serverExternalPackages: ["@libsql/client"],
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/.well-known/agent-card.json",
        destination: "/api/agent-card.json",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/c/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/manage",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/svm/exact/client": false,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };
    return config;
  },
};

export default nextConfig;

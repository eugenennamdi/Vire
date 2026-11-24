import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@vire/shared", "@vire/celo-infra", "@vire/textile", "@vire/agent"],
  serverExternalPackages: ["@libsql/client"],
  poweredByHeader: false,
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

import { CELO_TOKENS } from "@vire/shared";
import { describe, expect, it } from "vitest";
import { buildCeloX402RouteConfig } from "../src/lib/x402-config.js";

describe("Celo Mainnet x402 route configuration", () => {
  const payTo = "0x1111111111111111111111111111111111111111" as const;

  it("uses explicit Celo Mainnet token objects + eip2612GasSponsoring for default multi-asset route", () => {
    const cfg = buildCeloX402RouteConfig({
      payTo,
      usdtAtomicAmount: "50000",
      description: "Verify endpoint",
    });

    const accepts = Array.isArray(cfg.accepts) ? cfg.accepts : [cfg.accepts];
    expect(accepts.length).toBe(5); // USDT, USDC, wARS, wBRL, wMXN
    expect(cfg.extensions).toHaveProperty("eip2612GasSponsoring");

    const usdtOption = accepts.find(
      (a) => typeof a.price === "object" && a.price.asset === CELO_TOKENS.USDT.address
    );
    expect(usdtOption).toBeDefined();
    expect(typeof usdtOption?.price).toBe("object");
    if (typeof usdtOption?.price === "object") {
      expect(usdtOption.price.amount).toBe("50000");
      expect(usdtOption.price.extra?.name).toBe("Tether USD");
      expect(usdtOption.price.extra?.version).toBe("1");
    }

    const warsOption = accepts.find(
      (a) => typeof a.price === "object" && a.price.asset === CELO_TOKENS.wARS.address
    );
    expect(warsOption).toBeDefined();
    if (typeof warsOption?.price === "object") {
      expect(warsOption.price.extra?.assetTransferMethod).toBe("permit2");
      expect(warsOption.price.extra?.name).toBe("Peso Argentino");
    }
  });

  it("omits eip2612GasSponsoring on cNGN route per Celo x402 facilitator spec", () => {
    const cfg = buildCeloX402RouteConfig({
      payTo,
      usdtAtomicAmount: "50000",
      description: "Verify endpoint",
      cngnOnly: true,
    });

    expect(cfg.extensions).toBeUndefined();
    const accepts = Array.isArray(cfg.accepts) ? cfg.accepts : [cfg.accepts];
    expect(accepts).toHaveLength(1);
    const opt = accepts[0]!;
    if (typeof opt.price === "object") {
      expect(opt.price.asset).toBe(CELO_TOKENS.cNGN.address);
      expect(opt.price.extra?.assetTransferMethod).toBe("permit2");
    }
  });
});

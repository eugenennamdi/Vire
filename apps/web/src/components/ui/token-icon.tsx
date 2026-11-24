import { cn } from "@/lib/utils";

export type KnownTokenSymbol =
  | "CELO"
  | "USDT"
  | "USDC"
  | "cNGN"
  | "IDRX"
  | "wARS"
  | "wBRL"
  | "wMXN"
  | "wCOP";

const TOKEN_ASSET_MAP: Record<
  KnownTokenSymbol,
  { src: string; alt: string; padded?: boolean; square?: boolean }
> = {
  CELO: { src: "/tokens/celo.jpg", alt: "Celo", square: true },
  USDT: { src: "/tokens/usdt.png", alt: "Tether USDT", padded: true },
  USDC: { src: "/tokens/usdc.png", alt: "USD Coin" },
  cNGN: { src: "/tokens/cngn.png", alt: "Compliant Naira (cNGN)", padded: true },
  IDRX: { src: "/tokens/idrx.png", alt: "IDRX (Indonesian Rupiah)" },
  wARS: { src: "/tokens/wars.png", alt: "Ripio Wrapped Argentine Peso (wARS)" },
  wBRL: { src: "/tokens/wbrl.png", alt: "Ripio Wrapped Brazilian Real (wBRL)" },
  wMXN: { src: "/tokens/wmxn.png", alt: "Ripio Wrapped Mexican Peso (wMXN)" },
  wCOP: { src: "/tokens/wcop.png", alt: "Ripio Wrapped Colombian Peso (wCOP)" },
};

export function isKnownTokenSymbol(sym: string): sym is KnownTokenSymbol {
  return sym in TOKEN_ASSET_MAP;
}

export function TokenIcon({
  symbol,
  size = 24,
  showChainBadge = false,
  className,
}: {
  symbol: string;
  size?: number;
  showChainBadge?: boolean;
  className?: string;
}) {
  const key = isKnownTokenSymbol(symbol) ? symbol : "USDT";
  const asset = TOKEN_ASSET_MAP[key];
  const badgeSize = Math.max(12, Math.round(size * 0.44));

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <span
        className={cn(
          "inline-flex h-full w-full items-center justify-center overflow-hidden ring-1 ring-black/[0.08]",
          asset.square ? "rounded-[26%]" : "rounded-full",
          asset.padded ? "bg-white p-[10%]" : "bg-white"
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.src}
          alt={asset.alt}
          width={size}
          height={size}
          decoding="async"
          className={cn(
            "h-full w-full select-none",
            asset.padded ? "object-contain" : "object-cover"
          )}
        />
      </span>

      {showChainBadge && key !== "CELO" && (
        <span
          title="Celo Mainnet"
          className="absolute -bottom-0.5 -right-0.5 overflow-hidden rounded-[30%] bg-[#FCFF52] ring-[1.75px] ring-white"
          style={{ width: badgeSize, height: badgeSize }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/tokens/celo.jpg"
            alt="Celo"
            width={badgeSize}
            height={badgeSize}
            decoding="async"
            className="h-full w-full object-cover"
          />
        </span>
      )}
    </span>
  );
}

export function TokenStack({
  symbols,
  size = 22,
  className,
}: {
  symbols: string[];
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {symbols.map((sym) => (
        <TokenIcon key={sym} symbol={sym} size={size} />
      ))}
    </span>
  );
}

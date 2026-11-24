import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Vire geometric brand mark — two precision-milled vectors separated by a
 * parallel clearing kerf (incoming verification vector + ascending FX blade).
 * Optical coordinates live on a 64x64 architectural grid.
 */
export const VIRE_MARK_PATHS = {
  leftBlade: "M11 16H21L37 50H27L11 16Z",
  rightWing: "M43 16H53L39.75 44.16L34.75 33.53L43 16Z",
} as const;

interface VireMarkProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** "badge" renders the white mark inside a #111111 squircle; "bare" renders currentColor. */
  variant?: "badge" | "bare";
  size?: number;
}

export function VireMark({
  variant = "badge",
  size = 24,
  className,
  ...props
}: VireMarkProps) {
  if (variant === "bare") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className={cn("shrink-0", className)}
        {...props}
      >
        <path d={VIRE_MARK_PATHS.leftBlade} fill="currentColor" />
        <path d={VIRE_MARK_PATHS.rightWing} fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...props}
    >
      <rect width="64" height="64" rx="14" fill="#111111" />
      <path d={VIRE_MARK_PATHS.leftBlade} fill="#FFFFFF" />
      <path d={VIRE_MARK_PATHS.rightWing} fill="#FFFFFF" />
    </svg>
  );
}

export function VireLogo({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <VireMark variant="badge" size={size} />
      <span className="text-[15px] font-semibold tracking-[-0.035em] text-[#111111]">
        Vire
      </span>
    </span>
  );
}

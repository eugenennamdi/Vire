import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium leading-4",
  {
    variants: {
      tone: {
        neutral: "border-white/[0.09] bg-white/[0.04] text-[#B4BAC5]",
        emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
        amber: "border-amber-500/25 bg-amber-500/10 text-amber-300",
        rose: "border-rose-500/25 bg-rose-500/10 text-rose-300",
        solid:
          "border-white/[0.16] bg-white/[0.08] text-[#F4F5F6] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

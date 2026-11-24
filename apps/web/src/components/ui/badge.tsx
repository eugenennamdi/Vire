import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 font-mono text-[11px] font-medium leading-4",
  {
    variants: {
      tone: {
        neutral: "border-[#E5E5E5] bg-[#FAFAFA] text-[#525252]",
        outline: "border-[#D4D4D4] bg-white text-[#111111]",
        ink: "border-[#111111] bg-[#111111] text-white",
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

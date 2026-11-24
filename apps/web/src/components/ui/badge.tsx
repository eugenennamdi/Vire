import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[4px] border px-2 py-0.5 font-mono text-[10.5px] font-medium uppercase leading-4 tracking-[0.04em]",
  {
    variants: {
      tone: {
        neutral: "border-[#E4E2DC] bg-[#F3F1EC] text-[#57554E]",
        outline: "border-[#C8C5BC] bg-white text-[#121210]",
        ink: "border-[#121210] bg-[#121210] text-[#FAF9F6]",
        destructive: "border-[#B42318]/30 bg-[#B42318]/[0.06] text-[#B42318]",
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

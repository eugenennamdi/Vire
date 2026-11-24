import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-medium leading-4",
  {
    variants: {
      tone: {
        neutral: "bg-[#F2F2F4] text-[#52525B] ring-1 ring-inset ring-black/[0.06]",
        outline: "bg-white text-[#0A0A0C] ring-1 ring-inset ring-black/[0.10]",
        ink: "bg-[#0A0A0C] text-white",
        positive: "bg-[#16A34A]/[0.08] text-[#15803D] ring-1 ring-inset ring-[#16A34A]/20",
        destructive: "bg-[#DC2626]/[0.08] text-[#B91C1C] ring-1 ring-inset ring-[#DC2626]/20",
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

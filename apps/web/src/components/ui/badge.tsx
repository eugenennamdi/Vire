import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] font-medium leading-4 tracking-[0.02em]",
  {
    variants: {
      tone: {
        neutral: "border-black/[0.08] bg-black/[0.03] text-muted-foreground",
        outline: "border-black/[0.14] bg-card text-foreground",
        ink: "border-foreground bg-foreground text-primary-foreground",
        destructive: "border-destructive/25 bg-destructive/[0.07] text-destructive",
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

import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  [
    "vire-pressable inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium",
    "select-none cursor-pointer disabled:pointer-events-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.16)] hover:bg-[#222222] disabled:border disabled:border-black/[0.06] disabled:bg-black/[0.05] disabled:text-muted-foreground/70 disabled:shadow-none",
        secondary:
          "border border-black/[0.09] bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-black/[0.18] hover:bg-[#FAFAFA] disabled:bg-[#FAFAFA] disabled:text-muted-foreground/60",
        outlineStrong:
          "border border-foreground bg-card text-foreground hover:bg-foreground hover:text-primary-foreground disabled:border-black/[0.08] disabled:text-muted-foreground/60",
        ghost:
          "bg-transparent text-muted-foreground hover:bg-black/[0.045] hover:text-foreground disabled:text-muted-foreground/50",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-3.5 text-[13px]",
        lg: "h-10 px-4 text-[13.5px]",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

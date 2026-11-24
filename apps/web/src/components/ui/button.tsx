import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  [
    "vire-pressable inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium",
    "select-none cursor-pointer disabled:pointer-events-none disabled:opacity-40",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08090A]",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-[#F4F5F6] text-[#08090A] hover:bg-white shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.6)]",
        secondary:
          "bg-[#15181D] text-[#F4F5F6] border border-white/[0.1] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:bg-[#1B1F26] hover:border-white/[0.16]",
        emerald:
          "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/22 hover:border-emerald-400/45",
        ghost:
          "bg-transparent text-[#A1A7B3] hover:bg-white/[0.06] hover:text-[#F4F5F6]",
        danger:
          "bg-rose-500/12 text-rose-300 border border-rose-500/30 hover:bg-rose-500/20",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-3.5 text-[13px]",
        lg: "h-10 px-4 text-sm",
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

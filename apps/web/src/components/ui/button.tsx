import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  [
    "vire-pressable inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium",
    "select-none cursor-pointer disabled:pointer-events-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A0A0C]/20 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F5F7]",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-[#0A0A0C] text-white shadow-[0_1px_2px_rgba(10,10,12,0.16)] hover:bg-[#232327] disabled:bg-[#E4E4E7] disabled:text-[#A1A1AA] disabled:shadow-none",
        secondary:
          "vire-pill-surface text-[#0A0A0C] hover:bg-[#FAFAFB] hover:shadow-[0_0_0_1px_rgba(10,10,12,0.16),0_2px_6px_rgba(10,10,12,0.06)] disabled:bg-[#F4F4F6] disabled:text-[#A1A1AA] disabled:shadow-none",
        outlineStrong:
          "bg-white text-[#0A0A0C] shadow-[0_0_0_1px_rgba(10,10,12,0.22)] hover:bg-[#0A0A0C] hover:text-white disabled:text-[#A1A1AA] disabled:shadow-[0_0_0_1px_rgba(10,10,12,0.08)]",
        ghost:
          "bg-transparent text-[#52525B] hover:bg-black/[0.045] hover:text-[#0A0A0C] disabled:text-[#A1A1AA]",
      },
      size: {
        sm: "h-9 px-3.5 text-[12.5px] sm:h-8",
        md: "h-10 px-4 text-[13.5px] sm:h-9",
        lg: "h-11 px-5 text-[14px] sm:h-10",
        icon: "h-9 w-9 p-0 sm:h-8 sm:w-8",
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

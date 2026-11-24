import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  [
    "vire-pressable inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[6px] font-medium",
    "select-none cursor-pointer disabled:pointer-events-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#121210]/25 focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF9F6]",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-[#121210] text-[#FAF9F6] hover:bg-[#292824] disabled:border disabled:border-[#E4E2DC] disabled:bg-[#F3F1EC] disabled:text-[#9E9B93]",
        secondary:
          "border border-[#D5D2C9] bg-white text-[#121210] hover:border-[#121210] hover:bg-[#FAF9F6] disabled:border-[#E4E2DC] disabled:bg-[#FAF9F6] disabled:text-[#9E9B93]",
        outlineStrong:
          "border border-[#121210] bg-white text-[#121210] hover:bg-[#121210] hover:text-[#FAF9F6] disabled:border-[#E4E2DC] disabled:text-[#9E9B93]",
        ghost:
          "bg-transparent text-[#68665F] hover:bg-[#EFECE6] hover:text-[#121210] disabled:text-[#9E9B93]",
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

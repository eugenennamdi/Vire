import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  [
    "vire-pressable inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium",
    "select-none cursor-pointer disabled:pointer-events-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111]/25 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-[#111111] text-white hover:bg-[#262626] disabled:border disabled:border-[#E5E5E5] disabled:bg-[#F4F4F5] disabled:text-[#A3A3A3]",
        secondary:
          "border border-[#E5E5E5] bg-white text-[#111111] hover:border-[#A3A3A3] hover:bg-[#FAFAFA] disabled:bg-[#FAFAFA] disabled:text-[#A3A3A3]",
        outlineStrong:
          "border border-[#111111] bg-white text-[#111111] hover:bg-[#111111] hover:text-white disabled:border-[#E5E5E5] disabled:text-[#A3A3A3]",
        ghost:
          "bg-transparent text-[#525252] hover:bg-[#F4F4F5] hover:text-[#111111] disabled:text-[#A3A3A3]",
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

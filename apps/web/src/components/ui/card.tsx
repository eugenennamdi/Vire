import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  elevated = false,
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { elevated?: boolean; interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-xl",
        elevated ? "vire-surface-elevated" : "vire-surface",
        interactive && "vire-interactive-card",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

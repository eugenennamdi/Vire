import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  elevated = false,
  muted = false,
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  elevated?: boolean;
  muted?: boolean;
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl",
        elevated ? "surface-elevated" : muted ? "surface-well rounded-xl" : "surface-card",
        interactive && "vire-interactive-card",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-6", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 pb-6", className)} {...props} />;
}

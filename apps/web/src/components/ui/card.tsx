import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  muted = false,
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  muted?: boolean;
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl",
        muted ? "vire-well" : "vire-card",
        interactive && "vire-card-interactive",
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

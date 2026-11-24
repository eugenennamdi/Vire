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
        "rounded-[6px]",
        muted ? "vire-band" : "vire-sheet",
        interactive && "vire-interactive-sheet",
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

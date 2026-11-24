"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  value: string;
  label?: string;
  toastMessage?: string;
  className?: string;
}

export function CopyButton({ value, label, toastMessage, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(toastMessage ?? "Copied");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Unable to access clipboard");
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label ? `Copy ${label}` : "Copy to clipboard"}
      className={cn(
        "vire-pressable inline-flex items-center gap-1.5 rounded-md border border-black/[0.09] bg-card px-2 py-1 font-mono text-[11px] text-muted-foreground shadow-[0_1px_1px_rgba(0,0,0,0.02)]",
        "hover:border-black/[0.2] hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20",
        className
      )}
    >
      <span className="relative flex h-3.5 w-3.5 items-center justify-center">
        <Copy
          weight="regular"
          className={cn(
            "absolute h-3.5 w-3.5 transition-[opacity,transform,filter] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
            copied ? "scale-75 opacity-0 blur-[2px]" : "scale-100 opacity-100 blur-0"
          )}
        />
        <Check
          weight="bold"
          className={cn(
            "absolute h-3.5 w-3.5 text-foreground transition-[opacity,transform,filter] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
            copied ? "scale-100 opacity-100 blur-0" : "scale-75 opacity-0 blur-[2px]"
          )}
        />
      </span>
      {label && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}

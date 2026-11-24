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

/**
 * Emil Kowalski micro-interaction: Copy -> Check crossfade masked with subtle 2px blur + scale(0.92).
 */
export function CopyButton({ value, label, toastMessage, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(toastMessage ?? "Copied to clipboard");
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
        "vire-pressable inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-[#B4BAC5]",
        "hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-[#F4F5F6]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
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
            "absolute h-3.5 w-3.5 text-emerald-400 transition-[opacity,transform,filter] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
            copied ? "scale-100 opacity-100 blur-0" : "scale-75 opacity-0 blur-[2px]"
          )}
        />
      </span>
      {label && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}

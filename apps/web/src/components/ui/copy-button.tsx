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
        "vire-pressable inline-flex items-center gap-1.5 rounded-[4px] border border-[#D5D2C9] bg-white px-2 py-1 font-mono text-[11px] text-[#57554E]",
        "hover:border-[#121210] hover:text-[#121210]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#121210]/20",
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
            "absolute h-3.5 w-3.5 text-[#121210] transition-[opacity,transform,filter] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
            copied ? "scale-100 opacity-100 blur-0" : "scale-75 opacity-0 blur-[2px]"
          )}
        />
      </span>
      {label && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}

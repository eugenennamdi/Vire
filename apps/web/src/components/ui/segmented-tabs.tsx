"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TabOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: ReactNode;
}

/**
 * Institutional capsule switcher — cool recessed well with crisp elevated white active thumb.
 */
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<TabOption<T>>;
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "vire-well inline-flex max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto rounded-full p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "vire-pressable inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[12px] font-medium sm:px-3 sm:text-[12.5px]",
              active
                ? "bg-white text-[#0A0A0C] shadow-[0_0_0_1px_rgba(10,10,12,0.07),0_1px_2px_rgba(10,10,12,0.06)]"
                : "text-[#71717A] hover:text-[#0A0A0C]"
            )}
          >
            {opt.icon}
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={cn(
                  "font-mono text-[11px] tabular-nums",
                  active ? "text-[#71717A]" : "text-[#A1A1AA]"
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

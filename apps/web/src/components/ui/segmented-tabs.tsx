"use client";

import { cn } from "@/lib/utils";

export interface TabOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

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
        "inline-flex flex-wrap items-center gap-0.5 rounded-md border border-[#E5E5E5] bg-[#FAFAFA] p-0.5",
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
              "vire-pressable inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-medium",
              active
                ? "border border-[#E5E5E5] bg-white text-[#111111]"
                : "border border-transparent text-[#737373] hover:text-[#111111]"
            )}
          >
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={cn(
                  "font-mono text-[10px] tabular-nums",
                  active ? "text-[#111111]" : "text-[#A3A3A3]"
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

"use client";

import { cn } from "@/lib/utils";

export interface TabOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/**
 * Architectural square-tab ledger switcher (flat 1px container, crisp black active state).
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
        "inline-flex flex-wrap items-center border border-[#E4E2DC] bg-white p-0.5 rounded-[6px]",
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
              "vire-pressable inline-flex items-center gap-1.5 whitespace-nowrap rounded-[4px] px-3 py-1.5 text-xs font-medium",
              active
                ? "bg-[#121210] text-[#FAF9F6]"
                : "text-[#68665F] hover:bg-[#F3F1EC] hover:text-[#121210]"
            )}
          >
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={cn(
                  "font-mono text-[10.5px] tabular-nums",
                  active ? "text-[#FAF9F6]/75" : "text-[#8D8A82]"
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

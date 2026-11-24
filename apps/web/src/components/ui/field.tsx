"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

const FIELD_CHROME =
  "w-full rounded-[10px] border border-black/[0.10] bg-white text-[13.5px] text-[#0A0A0C] placeholder:text-[#A1A1AA] " +
  "transition-[border-color,box-shadow,background-color] duration-150 " +
  "hover:border-black/[0.20] focus:border-black/[0.35] focus:outline-none focus:ring-[3px] focus:ring-black/[0.05] " +
  "disabled:cursor-not-allowed disabled:bg-[#F4F4F6] disabled:text-[#A1A1AA]";

const FIELD_BASE = `${FIELD_CHROME} px-3.5`;

export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-[12.5px] font-medium text-[#3F3F46]", className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_BASE, "h-10", className)} {...props} />;
}

interface ParsedOption {
  value: string;
  label: string;
  disabled?: boolean;
}

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return flattenText(node.props.children);
  return "";
}

function extractOptions(children: ReactNode): ParsedOption[] {
  const out: ParsedOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) {
      return;
    }
    if (child.type === "option") {
      const label = flattenText(child.props.children).trim();
      const value =
        child.props.value !== undefined ? String(child.props.value) : label;
      out.push({ value, label, disabled: child.props.disabled });
    } else if (child.props.children) {
      out.push(...extractOptions(child.props.children));
    }
  });
  return out;
}

/**
 * Institutional monochrome custom Select preserving the native <Select><option /></Select> API.
 * Avoids cross-browser native <select> double-arrow and text-alignment bugs across Chrome, Safari,
 * and embedded WebViews while matching Vire's hairline popover aesthetic.
 */
export function Select({
  id,
  className,
  value,
  defaultValue,
  onChange,
  disabled,
  children,
  "aria-label": ariaLabel,
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = useMemo(() => extractOptions(children), [children]);
  const listboxId = useId();
  const [internalValue, setInternalValue] = useState(
    defaultValue !== undefined ? String(defaultValue) : options[0]?.value ?? ""
  );
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const currentValue = value !== undefined ? String(value) : internalValue;
  const selected = options.find((o) => o.value === currentValue) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleChoose = (nextVal: string) => {
    if (value === undefined) setInternalValue(nextVal);
    setOpen(false);
    if (onChange) {
      const synthetic = {
        target: { value: nextVal },
        currentTarget: { value: nextVal },
      } as ChangeEvent<HTMLSelectElement>;
      onChange(synthetic);
    }
  };

  return (
    <div ref={rootRef} className="relative w-full min-w-0">
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          FIELD_CHROME,
          "flex h-10 min-w-0 items-center justify-between gap-2.5 px-3.5 text-left cursor-pointer",
          open && "border-black/[0.35] ring-[3px] ring-black/[0.05]",
          className
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? "Select…"}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[#71717A] transition-transform duration-150 ease-[var(--ease-out)]",
            open && "rotate-180 text-[#0A0A0C]"
          )}
        >
          <path
            d="M4 6.25L8 10.25L12 6.25"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1.5 max-h-64 overflow-auto rounded-xl bg-white p-1 shadow-[0_0_0_1px_rgba(10,10,12,0.08),0_12px_28px_-8px_rgba(10,10,12,0.14)]"
        >
          {options.map((opt) => {
            const active = opt.value === currentValue;
            return (
              <li key={opt.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => handleChoose(opt.value)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors duration-100",
                    active
                      ? "bg-[#F4F4F6] font-medium text-[#0A0A0C]"
                      : "text-[#3F3F46] hover:bg-[#FAFAFB] hover:text-[#0A0A0C]",
                    opt.disabled && "pointer-events-none opacity-45"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                  {active && (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      fill="none"
                      className="h-3.5 w-3.5 shrink-0 text-[#0A0A0C]"
                    >
                      <path
                        d="M3.5 8.5L6.5 11.5L12.5 4.5"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_BASE, "py-2.5 leading-relaxed", className)} {...props} />;
}

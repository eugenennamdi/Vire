import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

const FIELD_BASE =
  "w-full rounded-lg border border-white/[0.1] bg-[#0B0D10] px-3 text-[13px] text-[#F4F5F6] placeholder:text-[#5C626D] " +
  "transition-[border-color,box-shadow,background-color] duration-150 " +
  "focus:border-white/[0.28] focus:bg-[#0E1014] focus:outline-none focus:ring-2 focus:ring-white/[0.08] " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-xs font-medium text-[#B4BAC5]", className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_BASE, "h-9", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative w-full">
      <select
        className={cn(
          FIELD_BASE,
          "h-9 cursor-pointer appearance-none truncate whitespace-nowrap py-0 pr-8 leading-[34px]",
          className
        )}
        {...props}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7280]"
      >
        <path
          d="M4.5 6.5L8 10L11.5 6.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_BASE, "py-2.5 leading-relaxed", className)} {...props} />;
}

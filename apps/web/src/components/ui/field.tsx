import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
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

export function Select({ className, style, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative w-full min-w-0">
      <select
        style={{
          WebkitAppearance: "none",
          MozAppearance: "none",
          appearance: "none",
          ...style,
        }}
        className={cn(
          FIELD_CHROME,
          "h-10 min-w-0 max-w-full cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap py-[9px] pl-3.5 pr-10 leading-5",
          className
        )}
        {...props}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        className="pointer-events-none absolute right-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#71717A]"
      >
        <path
          d="M4 6.25L8 10.25L12 6.25"
          stroke="currentColor"
          strokeWidth="1.6"
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

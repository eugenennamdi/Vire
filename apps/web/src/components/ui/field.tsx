import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

const FIELD_BASE =
  "w-full rounded-md border border-[#E5E5E5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#A3A3A3] " +
  "transition-[border-color,box-shadow] duration-150 " +
  "hover:border-[#D4D4D4] focus:border-[#111111] focus:outline-none focus:ring-2 focus:ring-black/[0.06] " +
  "disabled:cursor-not-allowed disabled:bg-[#FAFAFA] disabled:text-[#A3A3A3]";

export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-xs font-medium text-[#525252]", className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_BASE, "h-9", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(FIELD_BASE, "h-9 min-w-0 max-w-full cursor-pointer", className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_BASE, "py-2.5 leading-relaxed", className)} {...props} />;
}

import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

const FIELD_BASE =
  "w-full rounded-[10px] border border-black/[0.10] bg-white px-3.5 text-[13.5px] text-[#0A0A0C] placeholder:text-[#A1A1AA] " +
  "transition-[border-color,box-shadow,background-color] duration-150 " +
  "hover:border-black/[0.20] focus:border-[#0A0A0C] focus:outline-none focus:ring-2 focus:ring-[#0A0A0C]/[0.07] " +
  "disabled:cursor-not-allowed disabled:bg-[#F4F4F6] disabled:text-[#A1A1AA]";

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

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(FIELD_BASE, "h-10 min-w-0 max-w-full cursor-pointer", className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_BASE, "py-2.5 leading-relaxed", className)} {...props} />;
}

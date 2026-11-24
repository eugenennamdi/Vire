import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

const FIELD_BASE =
  "w-full rounded-[6px] border border-[#D5D2C9] bg-white px-3 text-[13px] text-[#121210] placeholder:text-[#9E9B93] " +
  "transition-[border-color,box-shadow] duration-150 " +
  "hover:border-[#A8A49A] focus:border-[#121210] focus:outline-none focus:ring-2 focus:ring-[#121210]/[0.07] " +
  "disabled:cursor-not-allowed disabled:bg-[#F3F1EC] disabled:text-[#9E9B93]";

export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-xs font-medium text-[#3D3C37]", className)}
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

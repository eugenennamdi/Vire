import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

const FIELD_BASE =
  "w-full rounded-lg border border-black/[0.11] bg-card px-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 " +
  "shadow-[0_1px_1px_rgba(0,0,0,0.02)] transition-[border-color,box-shadow] duration-150 " +
  "hover:border-black/[0.2] focus:border-foreground focus:outline-none focus:ring-2 focus:ring-black/[0.07] " +
  "disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground/60";

export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-xs font-medium text-foreground/80", className)}
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

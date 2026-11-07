import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "flex h-12 w-full rounded-[12px] border border-line bg-white px-4 text-[17px] text-ink placeholder:text-slate-400 transition-colors",
        "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15",
        "disabled:cursor-not-allowed disabled:opacity-50",
        invalid && "border-danger focus-visible:border-danger focus-visible:ring-danger/15 bg-red-50/40",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

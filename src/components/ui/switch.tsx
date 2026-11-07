"use client";
import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  id,
  disabled,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-slate-300",
      )}
    >
      <span
        className={cn(
          "inline-block h-6 w-6 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-7" : "translate-x-1",
        )}
      />
    </button>
  );
}

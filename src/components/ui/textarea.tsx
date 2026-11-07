import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-28 w-full rounded-[12px] border border-line bg-white px-4 py-3 text-[15px] text-ink placeholder:text-slate-400",
        "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

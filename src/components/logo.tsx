"use client";

import { useState } from "react";
import { business } from "@config/business";
import { cn } from "@/lib/utils";

/**
 * The one logo component used everywhere (config/business.ts → logo).
 * Falls back to the business name as text if the image can't load.
 * `tone` sets the fallback text colour for dark or light backgrounds.
 */
export function Logo({ tone = "dark", className }: { tone?: "dark" | "light"; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className={cn(
          "inline-flex items-center font-extrabold leading-none tracking-tight",
          tone === "dark" ? "text-white" : "text-ink",
          className,
        )}
      >
        {business.name}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={business.logo.src}
      alt={business.logo.alt}
      className={cn("h-11 w-auto object-contain", className)}
      onError={() => setFailed(true)}
      decoding="async"
    />
  );
}

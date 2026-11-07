"use client";

import { useState } from "react";
import { useBrand } from "@/components/brand-provider";
import { cn } from "@/lib/utils";

/**
 * The one logo component used everywhere.
 * Priority: logo uploaded in Settings → /public/logo.png → text "Sai Motor Works".
 * `tone` picks the built-in artwork for dark (navy) or light (white) backgrounds.
 */
export function Logo({ tone = "dark", className }: { tone?: "dark" | "light"; className?: string }) {
  const { logoUrl, businessName } = useBrand();
  const fallback = tone === "dark" ? "/logo.png" : "/logo-on-light.png";
  const candidates = logoUrl ? [logoUrl, fallback] : [fallback];
  const [failed, setFailed] = useState<string[]>([]);
  const src = candidates.find((c) => !failed.includes(c));

  if (!src) {
    return (
      <span
        className={cn(
          "inline-flex items-center font-extrabold italic leading-none tracking-tight",
          tone === "dark" ? "text-white" : "text-ink",
          className,
        )}
      >
        {businessName}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={businessName}
      className={cn("h-11 w-auto object-contain", className)}
      onError={() => setFailed((f) => [...f, src])}
      decoding="async"
    />
  );
}

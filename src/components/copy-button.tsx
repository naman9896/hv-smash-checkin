"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Copies text; falls back to a hidden textarea + execCommand where the Clipboard API is missing or blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  const active = document.activeElement as HTMLElement | null;
  ta.select();
  ta.setSelectionRange(0, text.length); // iOS
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  active?.focus?.({ preventScroll: true });
  return ok;
}

/**
 * Small copy icon for a detail row. Renders nothing for an empty value.
 * 44×44 tap area; the icon turns into a green tick for 1.5 s after copying.
 * Keep it outside any <a> so it never triggers tel:/mailto: links.
 */
export function CopyButton({ value, label, className }: { value: string | number | null | undefined; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const text = value == null ? "" : String(value).trim();
  if (!text) return null;

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (await copyText(text)) {
      setCopied(true);
      toast.success(`${label} copied`, { duration: 1500 });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error(`Couldn't copy ${label.toLowerCase()}`);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
      title={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] transition-colors",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20",
        copied ? "text-success" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
        className,
      )}
    >
      {copied ? <Check className="h-[18px] w-[18px]" aria-hidden="true" /> : <Copy className="h-[18px] w-[18px]" aria-hidden="true" />}
    </button>
  );
}

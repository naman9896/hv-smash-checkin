"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Delete, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Touch-friendly 4–6 digit PIN pad. `onSubmit` returns an error message,
 * or null when the PIN was accepted.
 */
export function PinPad({
  onSubmit,
  tone = "light",
  autoFocus = true,
}: {
  onSubmit: (pin: string) => Promise<string | null>;
  tone?: "light" | "dark";
  autoFocus?: boolean;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  const submit = useCallback(
    async (value: string) => {
      if (value.length < 4 || busy) return;
      setBusy(true);
      setError(null);
      const err = await onSubmit(value);
      setBusy(false);
      if (err) {
        setError(err);
        setPin("");
        setShake(true);
        setTimeout(() => setShake(false), 450);
      }
    },
    [busy, onSubmit],
  );

  const press = useCallback(
    (k: string) => {
      if (busy) return;
      setError(null);
      if (k === "del") setPin((p) => p.slice(0, -1));
      else if (k === "ok") submit(pin);
      else setPin((p) => (p.length < 6 ? p + k : p));
    },
    [busy, pin, submit],
  );

  // Physical keyboard support (desktop)
  useEffect(() => {
    if (!autoFocus) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("del");
      else if (e.key === "Enter") press("ok");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [autoFocus, press]);

  const dark = tone === "dark";
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"];

  return (
    <div className="mx-auto w-full max-w-[300px]">
      <div className={cn("flex justify-center gap-3", shake && "animate-shake")} aria-live="polite" aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-4 w-4 rounded-full border-2 transition-colors",
              i < pin.length
                ? dark
                  ? "border-white bg-white"
                  : "border-ink bg-ink"
                : i < 4
                  ? dark
                    ? "border-white/50"
                    : "border-slate-400"
                  : dark
                    ? "border-white/20"
                    : "border-slate-200",
            )}
          />
        ))}
      </div>
      <p className={cn("mt-3 min-h-[22px] text-center text-sm font-medium", dark ? "text-red-300" : "text-danger")} role="alert">
        {error}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            disabled={busy || (k === "ok" && pin.length < 4)}
            aria-label={k === "del" ? "Delete digit" : k === "ok" ? "Enter PIN" : k}
            className={cn(
              "flex h-16 items-center justify-center rounded-[16px] text-2xl font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:opacity-40",
              k === "ok"
                ? "bg-primary text-white hover:bg-primary-hover"
                : dark
                  ? "bg-white/10 text-white hover:bg-white/20"
                  : "bg-slate-100 text-ink hover:bg-slate-200",
            )}
          >
            {k === "del" ? <Delete className="h-6 w-6" /> : k === "ok" ? busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Check className="h-7 w-7" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { findMake, VEHICLE_MAKES } from "@/lib/vehicle-makes";

const OTHER = "__other__";

/**
 * Vehicle make dropdown (popular first, then A–Z) with "Other (not listed)",
 * which shows a text box. The parent owns `other` so chips can set it too.
 */
export function MakeSelect({
  id,
  value,
  other,
  onPick,
  onType,
  onBlur,
  invalid,
  describedBy,
  popular = [],
}: {
  id: string;
  value: string;
  other: boolean;
  /** A make was chosen from the list, or "Other" (`other` = true, value ""). */
  onPick: (value: string, other: boolean) => void;
  onType: (value: string) => void;
  onBlur?: () => void;
  invalid?: boolean;
  describedBy?: string;
  popular?: string[];
}) {
  const popularListed = popular.map(findMake).filter((m): m is NonNullable<typeof m> => !!m);
  return (
    <>
      <div className="relative">
        <select
          id={id}
          value={other ? OTHER : (findMake(value) ?? "")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === OTHER) {
              onPick("", true);
              setTimeout(() => document.getElementById(`${id}-other`)?.focus(), 50);
            } else onPick(v, false);
          }}
          onBlur={() => !other && onBlur?.()}
          aria-invalid={(invalid && !other) || undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-14 w-full appearance-none rounded-[12px] border border-line bg-white pl-4 pr-11 text-[17px] text-ink transition-colors",
            "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15",
            !value && !other && "text-slate-400",
            invalid && !other && "border-danger bg-red-50/40 focus-visible:border-danger focus-visible:ring-danger/15",
          )}
        >
          <option value="" disabled>
            Select make
          </option>
          {popularListed.length > 0 && (
            <optgroup label="Popular">
              {popularListed.map((m) => (
                <option key={`p-${m}`} value={m}>
                  {m}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="All makes (A–Z)">
            {VEHICLE_MAKES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </optgroup>
          <option value={OTHER}>Other (not listed)</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
      </div>
      {other && (
        <Input
          id={`${id}-other`}
          aria-label="Type the vehicle make"
          autoCapitalize="words"
          placeholder="Type the make"
          maxLength={60}
          value={value}
          onChange={(e) => onType(e.target.value)}
          onBlur={onBlur}
          invalid={invalid}
          aria-describedby={describedBy}
          className="h-14"
        />
      )}
    </>
  );
}

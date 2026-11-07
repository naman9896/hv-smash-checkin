"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, GripVertical, Plus, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { FormField, SaveFooter, SettingsCard, textareaClass, ToggleRow, useSettingsDraft } from "@/components/settings/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_CONSENT, DEFAULT_QUICK_MAKES } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { findMake, VEHICLE_MAKES } from "@/lib/vehicle-makes";

const KEYS = [
  "kiosk_enabled",
  "kiosk_paused_message",
  "kiosk_title",
  "kiosk_subtitle",
  "consent_text",
  "show_year",
  "show_colour",
  "show_odometer",
  "email_required",
  "quick_makes",
  "thank_you_reset_seconds",
  "idle_timeout_minutes",
] as const;

export function KioskTab({ onDirty }: { onDirty: (d: boolean) => void }) {
  const { draft, set, dirty, saving, save, discard } = useSettingsDraft(KEYS);
  const [newMake, setNewMake] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const makes = draft.quick_makes;
  function addMake() {
    const typed = newMake.trim().replace(/\s+/g, " ");
    // Use the dropdown's spelling so the chip selects the right make on the kiosk
    const m = findMake(typed) ?? typed;
    if (!m) return;
    if (makes.some((x) => x.toLowerCase() === m.toLowerCase())) return setNewMake("");
    set("quick_makes", [...makes, m]);
    setNewMake("");
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= makes.length || from === to) return;
    const next = [...makes];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    set("quick_makes", next);
  }

  async function onSave() {
    setError(null);
    if (draft.thank_you_reset_seconds < 3 || draft.thank_you_reset_seconds > 120) return setError("Thank-you delay must be 3–120 seconds.");
    if (draft.idle_timeout_minutes < 1 || draft.idle_timeout_minutes > 60) return setError("Idle timeout must be 1–60 minutes.");
    await save();
  }

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Kiosk"
        description={
          <>
            Changes apply to the iPad straight away, no reload needed.{" "}
            <Link href="/kiosk" target="_blank" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              Open kiosk <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </>
        }
        footer={<SaveFooter dirty={dirty} saving={saving} onSave={onSave} onDiscard={discard} />}
      >
        <div className="divide-y divide-line">
          <ToggleRow
            id="kiosk-enabled"
            label="Accept check-ins"
            description="Turn off to pause the kiosk and show the message below."
            checked={draft.kiosk_enabled}
            onCheckedChange={(v) => set("kiosk_enabled", v)}
          />
          <div className="pb-5 pt-3">
            <FormField id="kiosk-paused" label="Paused-screen message">
              <Input id="kiosk-paused" value={draft.kiosk_paused_message ?? ""} onChange={(e) => set("kiosk_paused_message", e.target.value)} />
            </FormField>
          </div>
        </div>

        <div className="mt-2 grid gap-5 border-t border-line pt-6 sm:grid-cols-2">
          <FormField id="kiosk-title" label="Welcome title">
            <Input id="kiosk-title" value={draft.kiosk_title ?? ""} onChange={(e) => set("kiosk_title", e.target.value)} />
          </FormField>
          <FormField id="kiosk-subtitle" label="Welcome subtitle">
            <Input id="kiosk-subtitle" value={draft.kiosk_subtitle ?? ""} onChange={(e) => set("kiosk_subtitle", e.target.value)} />
          </FormField>
          <FormField id="kiosk-consent" label="Consent / authorisation text" className="sm:col-span-2">
            <textarea id="kiosk-consent" className={textareaClass} value={draft.consent_text ?? ""} onChange={(e) => set("consent_text", e.target.value)} />
            <button type="button" onClick={() => set("consent_text", DEFAULT_CONSENT)} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Restore default wording
            </button>
          </FormField>
        </div>
      </SettingsCard>

      <SettingsCard title="Form fields" footer={<SaveFooter dirty={dirty} saving={saving} onSave={onSave} onDiscard={discard} />}>
        <div className="divide-y divide-line">
          <ToggleRow id="show-year" label="Show Year" checked={draft.show_year} onCheckedChange={(v) => set("show_year", v)} />
          <ToggleRow id="show-colour" label="Show Colour" checked={draft.show_colour} onCheckedChange={(v) => set("show_colour", v)} />
          <ToggleRow id="show-odometer" label="Show Odometer" checked={draft.show_odometer} onCheckedChange={(v) => set("show_odometer", v)} />
          <ToggleRow
            id="email-required"
            label="Email required"
            description="When off, customers may leave email blank."
            checked={draft.email_required}
            onCheckedChange={(v) => set("email_required", v)}
          />
        </div>

        <div className="mt-4 border-t border-line pt-6">
          <p className="text-[15px] font-semibold">Quick-select make chips</p>
          <p className="text-sm text-muted">Drag to reorder (or use the arrows). Tapping a chip on the kiosk fills in Vehicle Make.</p>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Quick-select makes">
            {makes.map((m, i) => (
              <li
                key={m}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null) move(dragIndex, i);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                className={cn(
                  "flex h-11 cursor-grab items-center gap-0.5 rounded-full border border-line bg-white pl-2 pr-1 text-[15px] font-semibold active:cursor-grabbing",
                  dragIndex === i && "opacity-50",
                )}
              >
                <GripVertical className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="rounded-full p-1 text-muted hover:bg-slate-100 disabled:opacity-30" aria-label={`Move ${m} left`}>
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-1">{m}</span>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === makes.length - 1} className="rounded-full p-1 text-muted hover:bg-slate-100 disabled:opacity-30" aria-label={`Move ${m} right`}>
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => set("quick_makes", makes.filter((x) => x !== m))}
                  className="rounded-full p-1 text-muted hover:bg-red-50 hover:text-danger"
                  aria-label={`Remove ${m}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex max-w-md gap-2">
            <label htmlFor="new-make" className="sr-only">
              Add a make
            </label>
            <Input
              id="new-make"
              placeholder="Add a make, e.g. Mitsubishi"
              value={newMake}
              maxLength={30}
              list="make-suggestions"
              onChange={(e) => setNewMake(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addMake();
                }
              }}
            />
            <datalist id="make-suggestions">
              {VEHICLE_MAKES.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <Button variant="outline" onClick={addMake} className="h-12">
              <Plus /> Add
            </Button>
          </div>
          <button type="button" onClick={() => set("quick_makes", DEFAULT_QUICK_MAKES)} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Restore default makes
          </button>
        </div>
      </SettingsCard>

      <SettingsCard title="Timers" footer={<SaveFooter dirty={dirty} saving={saving} onSave={onSave} onDiscard={discard} />}>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="thanks-delay" label="Thank-you screen reset (seconds)" hint="3–120 seconds">
            <Input
              id="thanks-delay"
              type="number"
              inputMode="numeric"
              min={3}
              max={120}
              value={draft.thank_you_reset_seconds}
              onChange={(e) => set("thank_you_reset_seconds", Number(e.target.value))}
            />
          </FormField>
          <FormField id="idle-timeout" label="Idle timeout (minutes)" hint="A 15-second “Still there?” prompt shows before the form clears.">
            <Input
              id="idle-timeout"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              value={draft.idle_timeout_minutes}
              onChange={(e) => set("idle_timeout_minutes", Number(e.target.value))}
            />
          </FormField>
        </div>
        {error && (
          <p role="alert" className="mt-4 rounded-[12px] bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        )}
      </SettingsCard>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { ExternalLink, RotateCcw } from "lucide-react";
import Link from "next/link";
import { business } from "@config/business";
import { FormField, SaveFooter, SettingsCard, textareaClass, ToggleRow, useSettingsDraft } from "@/components/settings/common";
import { Input } from "@/components/ui/input";

const KEYS = [
  "kiosk_enabled",
  "kiosk_paused_message",
  "kiosk_title",
  "kiosk_subtitle",
  "consent_text",
  "thank_you_reset_seconds",
  "idle_timeout_minutes",
] as const;

export function KioskTab({ onDirty }: { onDirty: (d: boolean) => void }) {
  const { draft, set, dirty, saving, save, discard } = useSettingsDraft(KEYS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

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
              <Input id="kiosk-paused" value={draft.kiosk_paused_message ?? ""} placeholder={business.kiosk.pausedMessage} onChange={(e) => set("kiosk_paused_message", e.target.value || null)} />
            </FormField>
          </div>
        </div>

        <div className="mt-2 grid gap-5 border-t border-line pt-6 sm:grid-cols-2">
          <FormField id="kiosk-title" label="Welcome title">
            <Input id="kiosk-title" value={draft.kiosk_title ?? ""} placeholder={business.kiosk.title} onChange={(e) => set("kiosk_title", e.target.value || null)} />
          </FormField>
          <FormField id="kiosk-subtitle" label="Welcome subtitle">
            <Input id="kiosk-subtitle" value={draft.kiosk_subtitle ?? ""} placeholder={business.kiosk.subtitle} onChange={(e) => set("kiosk_subtitle", e.target.value || null)} />
          </FormField>
          <FormField id="kiosk-consent" label="Consent / authorisation text" className="sm:col-span-2">
            <textarea id="kiosk-consent" className={textareaClass} value={draft.consent_text ?? ""} placeholder={business.kiosk.consent} onChange={(e) => set("consent_text", e.target.value || null)} />
            <button type="button" onClick={() => set("consent_text", null)} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Restore default wording
            </button>
          </FormField>
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

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useDashboard } from "@/components/dashboard/shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateSettings } from "@/lib/data";
import type { Settings } from "@/lib/types";
import { cn } from "@/lib/utils";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Local draft of some settings columns, with dirty tracking and save. */
export function useSettingsDraft<K extends keyof Settings>(keys: readonly K[]) {
  const { settings, setSettings } = useDashboard();
  const pick = useCallback((s: Settings) => Object.fromEntries(keys.map((k) => [k, s[k]])) as Pick<Settings, K>, [keys]);
  const [draft, setDraft] = useState(() => pick(settings));
  const [saving, setSaving] = useState(false);
  const dirty = keys.some((k) => !same(draft[k], settings[k]));
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  });

  // Pick up changes saved elsewhere (another tab or device) unless we're mid-edit
  useEffect(() => {
    if (!dirtyRef.current) setDraft(pick(settings));
  }, [settings, pick]);

  const set = useCallback(<P extends K>(k: P, v: Settings[P]) => setDraft((d) => ({ ...d, [k]: v })), []);

  const save = useCallback(
    async (patch?: Partial<Pick<Settings, K>>) => {
      setSaving(true);
      try {
        const saved = await updateSettings({ ...draft, ...patch });
        setSettings(saved);
        setDraft(pick(saved));
        toast.success("Settings saved");
        return true;
      } catch (e) {
        toast.error("Couldn't save settings", { description: e instanceof Error ? e.message : undefined });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [draft, pick, setSettings],
  );

  const discard = useCallback(() => setDraft(pick(settings)), [pick, settings]);

  return { draft, set, dirty, saving, save, discard };
}

export function SettingsCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[20px] border border-line bg-white shadow-soft", className)}>
      <div className="p-5 sm:p-7">
        <h2 className="text-lg font-bold">{title}</h2>
        {description && <p className="mt-1 text-[15px] text-muted">{description}</p>}
        <div className="mt-5">{children}</div>
      </div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-4 sm:px-7">{footer}</div>}
    </section>
  );
}

export function SaveFooter({ dirty, saving, onSave, onDiscard, label = "Save changes" }: { dirty: boolean; saving: boolean; onSave: () => void; onDiscard?: () => void; label?: string }) {
  return (
    <>
      {dirty && <span className="mr-auto text-sm font-medium text-warning">Unsaved changes</span>}
      {dirty && onDiscard && (
        <Button variant="ghost" onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
      )}
      <Button onClick={onSave} disabled={!dirty || saving}>
        {saving ? <Loader2 className="animate-spin" /> : <Save />} {label}
      </Button>
    </>
  );
}

export function FormField({ id, label, hint, required, error, children, className }: { id: string; label: string; hint?: string; required?: boolean; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children}
      {hint && !error && (
        <p className="text-sm text-muted" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ToggleRow({ id, label, description, checked, onCheckedChange, disabled }: { id: string; label: string; description?: string; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <label htmlFor={id} className="text-[15px] font-semibold text-ink">
          {label}
        </label>
        {description && (
          <p className="text-sm text-muted" id={`${id}-desc`}>
            {description}
          </p>
        )}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-describedby={description ? `${id}-desc` : undefined} />
    </div>
  );
}

export const textareaClass =
  "flex min-h-24 w-full rounded-[12px] border border-line bg-white px-4 py-3 text-[16px] text-ink placeholder:text-slate-400 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15";

export const selectClass =
  "h-12 w-full rounded-[12px] border border-line bg-white px-3 text-[16px] text-ink focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15";

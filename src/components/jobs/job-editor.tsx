"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useBrand } from "@/components/brand-provider";
import { useDashboard } from "@/components/dashboard/shell";
import { JobForm, type JobFormValue } from "@/components/jobs/job-form";
import { Button } from "@/components/ui/button";
import { cleanJob } from "@/lib/jobs";
import type { JobOwnerFields, JobStaffFields } from "@/lib/types";
import { validateJob } from "@/lib/validation";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Trimmed, ready-to-save job (staff + owner fields). */
export function cleanOwnerJob(v: JobFormValue): JobStaffFields & Partial<JobOwnerFields> {
  const t = (s: string | null | undefined) => (s ?? "").trim() || null;
  return {
    ...cleanJob(v),
    status: v.status ?? "new",
    time_in: v.time_in ?? null,
    time_out: v.time_out ?? null,
    labour_total: v.labour_total ?? null,
    po_number: t(v.po_number),
    tax_invoice_number: t(v.tax_invoice_number),
    invoice_sent_on: v.invoice_sent_on || null,
    owner_notes: t(v.owner_notes),
  };
}

/**
 * Owner's editable job sheet with a save bar. Picks up live changes from
 * elsewhere (e.g. another device) as long as there are no unsaved edits.
 */
export function JobEditor({
  initial,
  onSave,
  saveLabel = "Save changes",
  alwaysDirty = false,
  hideEmployee = false,
}: {
  initial: JobFormValue;
  onSave: (job: JobStaffFields & Partial<JobOwnerFields>) => Promise<void>;
  saveLabel?: string;
  /** New jobs: the save button is always enabled. */
  alwaysDirty?: boolean;
  /** The mechanic is changed from the job page header instead, so never save it from here. */
  hideEmployee?: boolean;
}) {
  const { settings } = useDashboard();
  const { kiosk } = useBrand();
  const [base, setBase] = useState(initial);
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = alwaysDirty || !same(value, base);

  // Live update from elsewhere: take it unless we're mid-edit
  if (!same(initial, base) && !dirty) {
    setBase(initial);
    setValue(initial);
  }

  // Warn before closing the tab with unsaved edits
  useEffect(() => {
    if (!dirty || alwaysDirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, alwaysDirty]);

  async function save() {
    const e = validateJob(value, "owner");
    if (value.time_in && value.time_out && new Date(value.time_out) < new Date(value.time_in)) e.time_out = "Time out is before time in";
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) {
      document.getElementById(`job-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      toast.error("Please fix the highlighted fields");
      return;
    }
    setSaving(true);
    try {
      const job = cleanOwnerJob(value);
      if (hideEmployee) delete (job as Partial<typeof job>).employee_name;
      await onSave(job);
      setBase(value);
    } catch (err) {
      toast.error("Couldn't save the job", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <JobForm
        value={value}
        onChange={(next) => {
          setValue(next);
          // Once errors are showing, re-check as they're fixed
          if (Object.keys(errors).length) setErrors(validateJob(next, "owner"));
        }}
        mode="owner"
        staffNames={settings.staff_names}
        errors={errors}
        popularMakes={kiosk.quick_makes}
        hideEmployee={hideEmployee}
      />
      <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-end gap-3">
          {dirty && !alwaysDirty && <span className="mr-auto text-sm font-medium text-warning">Unsaved changes</span>}
          {dirty && !alwaysDirty && (
            <Button variant="ghost" onClick={() => setValue(base)} disabled={saving}>
              Discard
            </Button>
          )}
          <Button onClick={save} disabled={!dirty || saving} size="lg">
            {saving ? <Loader2 className="animate-spin" /> : <Save />} {saveLabel}
          </Button>
        </div>
      </div>
    </>
  );
}

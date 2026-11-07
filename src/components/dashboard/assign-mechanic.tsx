"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, HardHat, Loader2, UserX } from "lucide-react";
import { toast } from "sonner";
import { useDashboard } from "@/components/dashboard/shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateCheckin } from "@/lib/data";
import type { Checkin } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

/**
 * Owner assigns this car to a mechanic (Settings → Staff), with optional
 * instructions. It then shows on that mechanic's Staff Job Sheet until they
 * start a job sheet for it.
 */
export function AssignMechanic({ c, hasJob }: { c: Checkin; hasJob: boolean }) {
  const { settings, upsertRow } = useDashboard();
  const [mechanic, setMechanic] = useState(c.assigned_to ?? "");
  const [note, setNote] = useState(c.assigned_note ?? "");
  const [saving, setSaving] = useState(false);

  // Keep a mechanic who was since removed from the Staff list selectable
  const names = c.assigned_to && !settings.staff_names.includes(c.assigned_to) ? [...settings.staff_names, c.assigned_to] : settings.staff_names;
  const dirty = mechanic !== (c.assigned_to ?? "") || note.trim() !== (c.assigned_note ?? "");

  async function save(assignedTo: string | null, assignedNote: string | null) {
    setSaving(true);
    try {
      const saved = await updateCheckin(c.id, { assigned_to: assignedTo, assigned_note: assignedNote });
      upsertRow(saved);
      setMechanic(saved.assigned_to ?? "");
      setNote(saved.assigned_note ?? "");
      toast.success(assignedTo ? `${c.rego} assigned to ${assignedTo}` : `${c.rego} unassigned`);
    } catch (e) {
      toast.error("Couldn't save the assignment", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-[20px] border border-line bg-white p-5">
      <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted">
        <HardHat className="h-3.5 w-3.5" aria-hidden="true" /> Assign mechanic
      </h2>

      {names.length === 0 ? (
        <p className="mt-3 text-[15px] text-muted">
          Add your mechanics in{" "}
          <Link href="/dashboard/settings#staff" className="font-semibold text-primary hover:underline">
            Settings → Staff
          </Link>{" "}
          first.
        </p>
      ) : (
        <>
          {c.assigned_to && (
            <p className="mt-2 text-sm text-muted">
              Assigned to <span className="font-semibold text-ink">{c.assigned_to}</span>
              {c.assigned_at && ` · ${timeAgo(c.assigned_at)}`}
              {hasJob ? " · job sheet started" : " · waiting on their job sheet"}
            </p>
          )}
          <label htmlFor={`assign-${c.id}`} className="sr-only">
            Mechanic
          </label>
          <div className="relative mt-3">
            <select
              id={`assign-${c.id}`}
              value={mechanic}
              onChange={(e) => setMechanic(e.target.value)}
              className="h-12 w-full appearance-none rounded-[12px] border border-line bg-white pl-4 pr-11 text-[15px] font-medium text-ink focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
            >
              <option value="">Not assigned</option>
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          </div>
          {mechanic && (
            <>
              <label htmlFor={`assign-note-${c.id}`} className="mt-3 block text-sm font-semibold text-ink">
                Instructions for {mechanic} <span className="font-normal text-muted">(optional)</span>
              </label>
              <Textarea
                id={`assign-note-${c.id}`}
                className="mt-1.5 min-h-20"
                maxLength={500}
                placeholder="e.g. Logbook service, check front pads, quote rear tyres"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={!dirty || saving || !mechanic} onClick={() => save(mechanic, note.trim() || null)}>
              {saving ? <Loader2 className="animate-spin" /> : <HardHat />} {c.assigned_to ? "Update" : "Assign"}
            </Button>
            {c.assigned_to && (
              <Button size="sm" variant="outline" disabled={saving} onClick={() => save(null, null)}>
                <UserX /> Unassign
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

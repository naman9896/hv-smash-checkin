"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Check, ClipboardList, History, Loader2, Mail, PenLine, Phone, Printer, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Plate, StatusPill } from "@/components/brand";
import { CheckinBooking } from "@/components/booking/owner/ready-sms";
import { AssignMechanic } from "@/components/dashboard/assign-mechanic";
import { useDashboard } from "@/components/dashboard/shell";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getSignatureUrl, updateCheckin } from "@/lib/data";
import { STATUSES, STATUS_LABEL, type Checkin, type CheckinStatus } from "@/lib/types";
import { cn, formatDateTime, formatKm, vehicleTitle } from "@/lib/utils";

/** Hero block (navy) for a check-in. `Title` lets the drawer pass its accessible dialog title. */
export function CheckinHero({ c, Title = "h1" }: { c: Checkin; Title?: React.ElementType }) {
  return (
    <div className="bg-navy px-6 pb-6 pt-6 text-white">
      <p className="font-mono text-sm text-slate-400">{c.reference_no}</p>
      <Title className="mt-1 pr-10 text-2xl font-bold">
        {c.first_name} {c.last_name}
      </Title>
      <p className="mt-1 text-sm text-slate-400">Checked in {formatDateTime(c.created_at)}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Plate rego={c.rego} />
        <StatusPill status={c.status} />
        {c.returning_customer && <ReturningBadge dark />}
        {c.is_archived && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-300">
            <Archive className="h-3.5 w-3.5" aria-hidden="true" /> Archived
          </span>
        )}
      </div>
    </div>
  );
}

export function ReturningBadge({ dark }: { dark?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
        dark ? "bg-plate/15 text-plate" : "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
      )}
    >
      <UserCheck className="h-3.5 w-3.5" aria-hidden="true" /> Returning customer
    </span>
  );
}

export function CheckinBody({ c, className }: { c: Checkin; className?: string }) {
  const { upsertRow, markRead, jobs } = useDashboard();
  const linkedJobs = jobs.filter((j) => j.checkin_id === c.id);
  const [sigUrl, setSigUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState(c.internal_notes ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!c.is_read) markRead(c.id);
  }, [c.id, c.is_read, markRead]);

  useEffect(() => {
    let cancelled = false;
    getSignatureUrl(c.signature_path).then((u) => !cancelled && setSigUrl(u));
    return () => {
      cancelled = true;
    };
  }, [c.signature_path]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Autosave notes 800ms after typing stops
  function onNotesChange(v: string) {
    setNotes(v);
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        upsertRow(await updateCheckin(c.id, { internal_notes: v }));
        setSaveState("saved");
      } catch (e) {
        setSaveState("idle");
        toast.error("Couldn't save notes", { description: e instanceof Error ? e.message : undefined });
      }
    }, 800);
  }

  // Optimistic: show the new status now, roll back if the save fails
  async function onStatusChange(s: CheckinStatus) {
    const before = c;
    upsertRow({ ...c, status: s });
    try {
      upsertRow(await updateCheckin(c.id, { status: s }));
      toast.success(`${c.reference_no} marked ${STATUS_LABEL[s]}`);
    } catch (e) {
      upsertRow(before);
      toast.error("Couldn't update status", { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function toggleArchive() {
    try {
      upsertRow(await updateCheckin(c.id, { is_archived: !c.is_archived }));
      toast.success(c.is_archived ? `${c.reference_no} restored` : `${c.reference_no} archived`);
    } catch (e) {
      toast.error("Couldn't update", { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <div className={cn("space-y-5", className)}>
      <section className="rounded-[20px] border border-line bg-white p-5">
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Job status</h2>
        <Select value={c.status} onValueChange={(v) => onStatusChange(v as CheckinStatus)}>
          <SelectTrigger className="mt-3" aria-label="Job status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/history/${encodeURIComponent(c.rego)}`}>
              <History /> View vehicle history
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={toggleArchive}>
            {c.is_archived ? <ArchiveRestore /> : <Archive />} {c.is_archived ? "Restore" : "Archive"}
          </Button>
        </div>
      </section>

      {/* Re-keyed so a change made elsewhere (another device) shows up */}
      <AssignMechanic key={`${c.id}:${c.assigned_to}:${c.assigned_note}`} c={c} hasJob={linkedJobs.length > 0} />

      <CheckinBooking c={c} />

      {linkedJobs.length > 0 && (
        <section className="rounded-[20px] border border-line bg-white p-5">
          <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Workshop job</h2>
          <ul className="mt-3 space-y-2">
            {linkedJobs.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/dashboard/jobs/${j.id}`}
                  className="flex items-center justify-between gap-3 rounded-[12px] border border-line px-4 py-3 hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-mono font-bold">
                      <ClipboardList className="h-4 w-4 text-muted" aria-hidden="true" /> {j.job_no}
                    </span>
                    <span className="block truncate text-sm text-muted">
                      {j.employee_name} · {j.work_items.join(", ") || "—"}
                    </span>
                  </span>
                  <StatusPill status={j.status} />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">This check-in&apos;s status follows the job.</p>
        </section>
      )}

      <section className="rounded-[20px] border border-line bg-white p-5">
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Customer</h2>
        <dl className="mt-3 space-y-3 text-[15px]">
          <DetailRow label="Name" value={`${c.first_name} ${c.last_name}`} />
          <DetailRow
            label="Mobile"
            value={
              <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
                <Phone className="h-4 w-4" aria-hidden="true" /> {c.phone}
              </a>
            }
          />
          <DetailRow
            label="Email"
            value={
              c.email ? (
                <a
                  href={`mailto:${c.email}?subject=${encodeURIComponent(`Your vehicle ${c.rego} – Sai Motor Works`)}`}
                  className="inline-flex items-center gap-1.5 break-all font-semibold text-primary hover:underline"
                >
                  <Mail className="h-4 w-4 shrink-0" aria-hidden="true" /> {c.email}
                </a>
              ) : (
                "—"
              )
            }
          />
        </dl>
      </section>

      <section className="rounded-[20px] border border-line bg-white p-5">
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Vehicle</h2>
        <p className="mt-2 text-lg font-bold">{vehicleTitle(c)}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-[15px]">
          <DetailRow label="Make" value={c.make} />
          <DetailRow label="Model" value={c.model} />
          <DetailRow label="Year" value={c.year ?? "—"} />
          <DetailRow label="Colour" value={c.colour || "—"} />
          <DetailRow label="Rego" value={<span className="font-mono font-bold tracking-wider">{c.rego}</span>} />
          <DetailRow label="Odometer" value={c.odometer_km != null ? `${formatKm(c.odometer_km)} km` : "—"} />
        </dl>
      </section>

      {/* Only older check-ins have a signature – the kiosk no longer asks for one */}
      {c.signature_path && (
        <section className="rounded-[20px] border border-line bg-white p-5">
          <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted">
            <PenLine className="h-3.5 w-3.5" aria-hidden="true" /> Signature
          </h2>
          <div className="mt-3 flex h-36 items-center justify-center rounded-[12px] border border-line bg-slate-50">
            {sigUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sigUrl} alt={`Signature of ${c.first_name} ${c.last_name}`} className="max-h-32 max-w-full" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-muted" aria-label="Loading signature" />
            )}
          </div>
          <p className="mt-2 text-sm text-muted">Signed {formatDateTime(c.signed_at)}</p>
        </section>
      )}

      <section className="rounded-[20px] border border-line bg-white p-5">
        <div className="flex items-center justify-between">
          <label htmlFor={`notes-${c.id}`} className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
            Internal staff notes
          </label>
          <span className="flex items-center gap-1 text-xs font-medium text-muted" aria-live="polite">
            {saveState === "saving" && (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </>
            )}
            {saveState === "saved" && (
              <>
                <Check className="h-3 w-3 text-success" /> Saved
              </>
            )}
          </span>
        </div>
        <Textarea
          id={`notes-${c.id}`}
          className="mt-3"
          placeholder="Work required, parts ordered, quotes… (not visible to customers)"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
        />
      </section>
    </div>
  );
}

export function PrintJobSheetButton({ id, className }: { id: string; className?: string }) {
  return (
    <Button size="lg" className={cn("w-full", className)} onClick={() => window.open(`/dashboard/${id}/print`, "_blank")}>
      <Printer /> Print Job Sheet
    </Button>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{value}</dd>
    </div>
  );
}

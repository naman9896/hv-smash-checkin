"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Check, ClipboardCopy, History, Loader2, Mail, PenLine, Phone, Printer, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { business } from "@config/business";
import { JobTypeBadge, StatusPill } from "@/components/brand";
import { CopyButton, copyText } from "@/components/copy-button";
import { useDashboard } from "@/components/dashboard/shell";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getSignatureUrl, updateCheckin } from "@/lib/data";
import { JOB_TYPE_LABEL, STATUSES, STATUS_LABEL, type Checkin, type CheckinStatus } from "@/lib/types";
import { cn, formatAuPhone, formatDateTime, phoneLabel, vehicleTitle } from "@/lib/utils";

/** Hero block (dark) for a check-in. `Title` lets the drawer pass its accessible dialog title. */
export function CheckinHero({ c, Title = "h1" }: { c: Checkin; Title?: React.ElementType }) {
  return (
    <div className="border-b-4 border-primary bg-navy px-6 pb-6 pt-6 text-white">
      <p className="font-mono text-sm text-slate-400">{c.reference_no}</p>
      <Title className="mt-1 pr-10 text-2xl font-bold">{c.customer_name}</Title>
      <p className="mt-1 text-sm text-slate-400">
        {vehicleTitle(c)} · Checked in {formatDateTime(c.created_at)}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusPill status={c.status} />
        <JobTypeBadge type={c.job_type} dark />
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

/** Everything the customer entered, as plain text for pasting into email or the quoting system. */
export function checkinAsText(c: Checkin): string {
  const lines = [
    `Name: ${c.customer_name}`,
    `${phoneLabel(c.phone)}: ${c.phone}`,
    `Email: ${c.email}`,
    `Vehicle: ${vehicleTitle(c)}`,
    c.job_type && `Job type: ${JOB_TYPE_LABEL[c.job_type]}`,
    (c.insurance_company || c.claim_number) &&
      [c.insurance_company && `Insurer: ${c.insurance_company}`, c.claim_number && `Claim #: ${c.claim_number}`].filter(Boolean).join(" | "),
    c.damage_description && `Damage: ${c.damage_description}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export function CheckinBody({ c, className }: { c: Checkin; className?: string }) {
  const { upsertRow, markRead } = useDashboard();
  const [sigUrl, setSigUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState(c.internal_notes ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [copiedAll, setCopiedAll] = useState(false);
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

  async function copyAll() {
    if (await copyText(checkinAsText(c))) {
      setCopiedAll(true);
      toast.success("All details copied", { duration: 1500 });
      setTimeout(() => setCopiedAll(false), 1500);
    } else {
      toast.error("Couldn't copy the details");
    }
  }

  const phoneKind = phoneLabel(c.phone);

  return (
    <div className={cn("space-y-5", className)}>
      <section className="rounded-[20px] border border-line bg-white p-5">
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Status</h2>
        <Select value={c.status} onValueChange={(v) => onStatusChange(v as CheckinStatus)}>
          <SelectTrigger className="mt-3" aria-label="Status">
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
            <Link href={`/dashboard/history/${encodeURIComponent(c.phone)}`}>
              <History /> Customer history
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={toggleArchive}>
            {c.is_archived ? <ArchiveRestore /> : <Archive />} {c.is_archived ? "Restore" : "Archive"}
          </Button>
        </div>
      </section>

      <section className="rounded-[20px] border border-line bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Customer &amp; vehicle</h2>
          <Button variant="outline" size="sm" onClick={copyAll} className="h-11" aria-label="Copy all details">
            {copiedAll ? <Check className="text-success" /> : <ClipboardCopy />} {copiedAll ? "Copied" : "Copy all details"}
          </Button>
        </div>

        <dl className="mt-2 divide-y divide-line text-[15px]">
          <DetailRow label="Name" value={c.customer_name} copy={c.customer_name} />
          <DetailRow
            label={phoneKind}
            copy={c.phone}
            value={
              <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
                <Phone className="h-4 w-4" aria-hidden="true" /> {formatAuPhone(c.phone)}
              </a>
            }
          />
          <DetailRow
            label="Email"
            copy={c.email}
            value={
              <a
                href={`mailto:${c.email}?subject=${encodeURIComponent(`Your ${vehicleTitle(c)} – ${business.name}`)}`}
                className="inline-flex items-center gap-1.5 break-all font-semibold text-primary hover:underline"
              >
                <Mail className="h-4 w-4 shrink-0" aria-hidden="true" /> {c.email}
              </a>
            }
          />
          <DetailRow label="Make" value={c.make} copy={c.make} />
          <DetailRow label="Model" value={c.model} copy={c.model} />
          <DetailRow label="Year" value={c.year} copy={c.year} />
          <DetailRow label="Job type" value={c.job_type && JOB_TYPE_LABEL[c.job_type]} copy={c.job_type && JOB_TYPE_LABEL[c.job_type]} />
          {c.insurance_company && <DetailRow label="Insurance company" value={c.insurance_company} copy={c.insurance_company} />}
          {c.claim_number && <DetailRow label="Claim number" value={<span className="font-mono">{c.claim_number}</span>} copy={c.claim_number} />}
          <DetailRow
            label="Damage description"
            value={c.damage_description && <span className="whitespace-pre-wrap">{c.damage_description}</span>}
            copy={c.damage_description}
          />
        </dl>
      </section>

      <section className="rounded-[20px] border border-line bg-white p-5">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted">
          <PenLine className="h-3.5 w-3.5" aria-hidden="true" /> Signature
        </h2>
        <div className="mt-3 flex h-36 items-center justify-center rounded-[12px] border border-line bg-white">
          {sigUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sigUrl} alt={`Signature of ${c.customer_name}`} className="max-h-32 max-w-full" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-muted" aria-label="Loading signature" />
          )}
        </div>
        <p className="mt-2 text-sm text-muted">Signed {formatDateTime(c.signed_at)}</p>
      </section>

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
          placeholder="Quote, parts ordered, assessor visit… (not visible to customers)"
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
      <Printer /> Print Check-in Sheet
    </Button>
  );
}

/** Label above, value left, copy button at the right end (outside any link). Empty values show "—" and no button. */
function DetailRow({ label, value, copy }: { label: string; value: React.ReactNode; copy: string | number | null | undefined }) {
  const empty = value === null || value === undefined || value === "" || value === false;
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-medium text-muted">{label}</dt>
        <dd className="mt-0.5 font-medium text-ink">{empty ? <span className="text-muted">—</span> : value}</dd>
      </div>
      {!empty && <CopyButton value={copy} label={label} />}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Link2, Link2Off, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/brand";
import { useDashboard } from "@/components/dashboard/shell";
import { listByRego, updateJob } from "@/lib/data";
import type { Checkin, Job } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

/**
 * Shows which customer check-in this job is linked to (matched by rego when
 * the job was saved) and lets the owner change or remove the link. While
 * linked, the check-in's status follows the job's.
 */
export function LinkedCheckin({ job }: { job: Job }) {
  const { rows, upsertJob } = useDashboard();
  const [candidates, setCandidates] = useState<Checkin[] | null>(null);
  const [saving, setSaving] = useState(false);

  // Check-ins for this rego (archived included), refreshed when live rows change
  const liveKey = rows
    .filter((r) => r.rego === job.rego || r.id === job.checkin_id)
    .map((r) => `${r.id}:${r.status}`)
    .join("|");
  useEffect(() => {
    let cancelled = false;
    listByRego(job.rego)
      .then((d) => !cancelled && setCandidates(d))
      .catch(() => !cancelled && setCandidates([]));
    return () => {
      cancelled = true;
    };
  }, [job.rego, liveKey]);

  const linked = candidates?.find((c) => c.id === job.checkin_id) ?? rows.find((r) => r.id === job.checkin_id) ?? null;

  async function relink(checkinId: string | null) {
    setSaving(true);
    try {
      upsertJob(await updateJob(job.id, { checkin_id: checkinId }));
      toast.success(checkinId ? "Job linked to check-in" : "Link removed");
    } catch (e) {
      toast.error("Couldn't change the link", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-6 rounded-[20px] border border-line bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px]", linked ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-muted")}>
            {linked ? <Link2 className="h-5 w-5" /> : <Link2Off className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Customer check-in</h2>
            {linked ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-2 font-semibold">
                <span className="font-mono">{linked.reference_no}</span>
                <span className="font-normal text-muted">
                  {linked.first_name} {linked.last_name} · {formatDate(linked.created_at)}
                </span>
                <StatusPill status={linked.status} />
              </p>
            ) : (
              <p className="mt-0.5 text-[15px] text-muted">
                {job.checkin_id ? "Loading…" : "Not linked to a check-in. Pick one to keep its status in step with this job."}
              </p>
            )}
            {linked && <p className="mt-1 text-sm text-muted">Its status follows this job: completing the job completes the check-in.</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {linked && (
            <Link
              href={`/dashboard/${linked.id}`}
              className="inline-flex h-11 items-center gap-1.5 rounded-[12px] border border-line px-4 text-[15px] font-semibold hover:bg-slate-50"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open check-in
            </Link>
          )}
          <label className="relative">
            <span className="sr-only">Change linked check-in</span>
            <select
              value={job.checkin_id ?? ""}
              disabled={saving || candidates === null}
              onChange={(e) => relink(e.target.value || null)}
              className="h-11 appearance-none rounded-[12px] border border-line bg-white pl-3 pr-10 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:opacity-60"
            >
              <option value="">{linked ? "Unlink" : "Link to a check-in…"}</option>
              {/* Keep the current link listed even if the job's rego was edited since */}
              {[...(linked && !candidates?.some((c) => c.id === linked.id) ? [linked] : []), ...(candidates ?? [])].map((c) => (
                <option key={c.id} value={c.id}>
                  {c.reference_no} · {formatDate(c.created_at)} · {c.first_name} {c.last_name}
                </option>
              ))}
            </select>
            {saving ? (
              <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />
            ) : (
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            )}
          </label>
        </div>
      </div>
      {candidates && candidates.length === 0 && !linked && <p className="mt-3 text-sm text-muted">There are no check-ins for {job.rego}.</p>}
    </section>
  );
}

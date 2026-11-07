"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronDown, HardHat, History, Loader2, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/brand";
import { DashboardHeader } from "@/components/dashboard/header";
import { useDashboard } from "@/components/dashboard/shell";
import { JobEditor } from "@/components/jobs/job-editor";
import { LinkedCheckin } from "@/components/jobs/linked-checkin";
import { useJob } from "@/components/jobs/use-job";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { deleteJob, updateCheckin, updateJob } from "@/lib/data";
import { jobFormValue } from "@/lib/jobs";
import { formatDateTime } from "@/lib/utils";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { upsertJob, upsertRow, removeJob, markJobRead, settings } = useDashboard();
  const [reassigning, setReassigning] = useState(false);
  const { job, state } = useJob(id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const initial = useMemo(() => (job ? jobFormValue(job) : null), [job]);

  useEffect(() => {
    if (job && !job.is_read) markJobRead(job.id);
  }, [job, markJobRead]);

  // Keep the current mechanic selectable even if they've left the Staff list
  const mechanics = job && !settings.staff_names.includes(job.employee_name) ? [...settings.staff_names, job.employee_name] : settings.staff_names;

  async function reassign(name: string) {
    if (!job || name === job.employee_name) return;
    setReassigning(true);
    try {
      upsertJob(await updateJob(job.id, { employee_name: name }));
      // Keep the linked check-in's "assigned to" in step
      if (job.checkin_id) upsertRow(await updateCheckin(job.checkin_id, { assigned_to: name }));
      toast.success(`${job.job_no} assigned to ${name}`);
    } catch (e) {
      toast.error("Couldn't reassign the job", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setReassigning(false);
    }
  }

  async function onDelete() {
    if (!job) return;
    setDeleting(true);
    try {
      await deleteJob(job.id);
      removeJob(job.id);
      toast.success(`${job.job_no} deleted`);
      router.replace("/dashboard/jobs");
    } catch (e) {
      toast.error("Couldn't delete the job", { description: e instanceof Error ? e.message : undefined });
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-screen bg-page">
      <DashboardHeader back={{ href: "/dashboard/jobs", label: "All jobs" }} />
      <main className="mx-auto max-w-5xl px-4 pt-6 sm:px-6">
        {state === "loading" && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading job…
          </div>
        )}
        {state === "missing" && <p className="py-20 text-center font-semibold">This job doesn&apos;t exist or was deleted.</p>}
        {job && initial && (
          <>
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-[20px] bg-navy p-6 text-white shadow-soft">
              <div>
                <p className="font-mono text-sm text-slate-400">{job.job_no}</p>
                <h1 className="mt-1 text-2xl font-bold">
                  {job.customer_name ? `${job.customer_name} · ` : ""}
                  <span className="font-mono tracking-wider">{job.rego}</span>
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  Created {formatDateTime(job.created_at)}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <StatusPill status={job.status} />
                  <label className="relative inline-flex items-center gap-2 text-sm text-slate-300">
                    <HardHat className="h-4 w-4" aria-hidden="true" />
                    <span>Mechanic</span>
                    <select
                      value={job.employee_name}
                      disabled={reassigning}
                      onChange={(e) => reassign(e.target.value)}
                      className="h-9 appearance-none rounded-[10px] border border-white/15 bg-white/10 pl-3 pr-8 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/20 disabled:opacity-60 [&>option]:text-ink"
                    >
                      {mechanics.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    {reassigning ? (
                      <Loader2 className="pointer-events-none absolute right-2.5 h-4 w-4 animate-spin" />
                    ) : (
                      <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4" aria-hidden="true" />
                    )}
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="dark">
                  <Link href={`/dashboard/history/${encodeURIComponent(job.rego)}`}>
                    <History /> Check-in history
                  </Link>
                </Button>
                <Button variant="dark" onClick={() => window.open(`/dashboard/jobs/${job.id}/print`, "_blank")}>
                  <Printer /> Print
                </Button>
                <Button variant="dark" onClick={() => setConfirmDelete(true)} aria-label="Delete job">
                  <Trash2 />
                </Button>
              </div>
            </div>

            <LinkedCheckin job={job} />

            <JobEditor
              key={job.id}
              hideEmployee
              initial={initial}
              onSave={async (patch) => {
                upsertJob(await updateJob(job.id, patch));
                toast.success(`${job.job_no} saved`);
              }}
            />
          </>
        )}
      </main>

      <Modal
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        icon={<Trash2 className="text-danger" />}
        title={`Delete ${job?.job_no ?? "job"}?`}
        description="The job sheet will be removed permanently."
      >
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="outline" size="lg" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="lg" onClick={onDelete} disabled={deleting}>
            {deleting && <Loader2 className="animate-spin" />} Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}

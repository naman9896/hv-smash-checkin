"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Car,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FilePlus2,
  HardHat,
  Loader2,
  Lock,
  MessageSquareText,
  RefreshCw,
  Send,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Plate } from "@/components/brand";
import { useBrand } from "@/components/brand-provider";
import { JobForm, type JobFormValue } from "@/components/jobs/job-form";
import { Logo } from "@/components/logo";
import { PinPad } from "@/components/pin-pad";
import { Button } from "@/components/ui/button";
import { staffAssignments, staffSubmitJob, staffUnlock } from "@/lib/data";
import { blankJob, cleanJob } from "@/lib/jobs";
import type { StaffAssignment } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { validateJob } from "@/lib/validation";

/** Re-lock the job sheet after this long without a touch. */
const IDLE_LOCK_MS = 15 * 60_000;

/**
 * Staff job sheet: shared staff PIN → pick your name → the cars the owner
 * assigned to you (or a blank sheet) → the paper job form.
 */
export default function StaffJobsPage() {
  const { kiosk } = useBrand();
  const [pin, setPin] = useState<string | null>(null);
  const [staffNames, setStaffNames] = useState<string[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<StaffAssignment[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  /** The assigned car the open job sheet was started from, if any. */
  const [from, setFrom] = useState<StaffAssignment | null>(null);
  const [job, setJob] = useState<JobFormValue>(blankJob);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const lastActivity = useRef(0);

  // Locking keeps an unfinished job sheet; the next person picks their name again
  const lock = useCallback(() => {
    setPin(null);
    setMe(null);
    setFormOpen(false);
  }, []);

  // Auto-lock when the tablet is left alone
  useEffect(() => {
    if (!pin) return;
    lastActivity.current = Date.now();
    const bump = () => (lastActivity.current = Date.now());
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    const t = setInterval(() => Date.now() - lastActivity.current > IDLE_LOCK_MS && lock(), 15_000);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, bump));
      clearInterval(t);
    };
  }, [pin, lock]);

  const loadAssignments = useCallback(
    async (name: string) => {
      if (!pin) return;
      setLoadingList(true);
      try {
        setAssignments(await staffAssignments(pin, name));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't load your jobs";
        toast.error("Couldn't load your assigned cars", { description: msg });
        if (/pin/i.test(msg)) lock();
      } finally {
        setLoadingList(false);
      }
    },
    [pin, lock],
  );

  async function onPin(p: string): Promise<string | null> {
    try {
      const r = await staffUnlock(p);
      if (!r.ok) return r.error;
      setStaffNames(r.staffNames);
      setPin(p);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Couldn't check the PIN";
    }
  }

  function pickName(name: string) {
    setMe(name);
    setAssignments(null);
    loadAssignments(name);
  }

  function hasDraft() {
    return !!(job.rego || job.make || job.model || job.work_items.some((w) => w.trim()) || job.parts.length);
  }

  /** Open the job sheet: blank, or pre-filled from an assigned car. */
  function openForm(a: StaffAssignment | null) {
    if (hasDraft() && !window.confirm("Discard the unfinished job sheet and start a new one?")) return;
    const base = blankJob();
    setJob(
      a
        ? {
            ...base,
            rego: a.rego,
            make: a.make,
            model: a.model,
            year: a.year,
            colour: a.colour ?? "",
            odometer: a.odometer_km != null ? String(a.odometer_km) : "",
          }
        : base,
    );
    setFrom(a);
    setErrors({});
    setFormKey((k) => k + 1);
    setFormOpen(true);
    window.scrollTo({ top: 0 });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin || !me || submitting) return;
    const toSave = { ...job, employee_name: me };
    const v = validateJob(toSave);
    setErrors(v);
    const first = Object.keys(v)[0];
    if (first) {
      document.getElementById(`job-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      toast.error("Please fill in the highlighted fields");
      return;
    }
    setSubmitting(true);
    try {
      const jobNo = await staffSubmitJob(pin, { ...cleanJob(toSave), checkin_id: from?.checkin_id ?? null });
      setSaved(jobNo);
      setJob(blankJob());
      setFrom(null);
      setFormOpen(false);
      window.scrollTo({ top: 0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Please try again.";
      toast.error("Couldn't save the job", { description: msg });
      if (/pin/i.test(msg)) lock();
    } finally {
      setSubmitting(false);
    }
  }

  // Once errors are showing, re-check as they're fixed
  function onChange(next: JobFormValue) {
    setJob(next);
    if (Object.keys(errors).length) setErrors(validateJob({ ...next, employee_name: me ?? "" }));
  }

  /* ---------- PIN gate ---------- */
  if (!pin) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-navy px-6 py-10 text-white">
        <Logo className="h-16 sm:h-20" />
        <div className="mt-8 flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
          <ClipboardList className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-2xl font-bold">Staff Job Sheet</h1>
        {kiosk.staff_pin_set ? (
          <>
            <p className="mt-1 text-sm text-slate-400">Enter the staff PIN to continue.</p>
            <div className="mt-8 w-full max-w-sm">
              <PinPad tone="dark" onSubmit={onPin} />
            </div>
          </>
        ) : (
          <p className="mt-4 max-w-sm text-center text-slate-300">
            The staff PIN hasn&apos;t been set up yet. The owner can set it in Dashboard → Settings → Staff.
          </p>
        )}
        <Link href="/" className="mt-10 inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to portals
        </Link>
      </main>
    );
  }

  /* ---------- who are you? ---------- */
  if (!me) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-navy px-6 py-10 text-white">
        <Logo className="h-14 sm:h-16" />
        <h1 className="mt-8 text-2xl font-bold">Who&apos;s working?</h1>
        <p className="mt-1 text-sm text-slate-400">Tap your name.</p>
        {staffNames.length === 0 ? (
          <p className="mt-6 max-w-sm text-center text-slate-300">No staff names yet. The owner can add them in Dashboard → Settings → Staff.</p>
        ) : (
          <div className="mt-8 grid w-full max-w-lg grid-cols-2 gap-3">
            {staffNames.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => pickName(n)}
                className="flex h-20 items-center justify-center gap-2 rounded-[16px] bg-white/10 text-xl font-semibold transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30"
              >
                <UserRound className="h-6 w-6 text-plate" aria-hidden="true" />
                {n}
              </button>
            ))}
          </div>
        )}
        <Button variant="dark" size="lg" className="mt-10" onClick={lock}>
          <Lock /> Lock
        </Button>
      </main>
    );
  }

  const header = (
    <header className="sticky top-0 z-30 bg-navy text-white shadow-lg">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Logo className="h-12 shrink-0 sm:h-14" />
          <p className="hidden truncate border-l border-white/15 pl-3 text-sm text-slate-400 sm:block">Staff Job Sheet</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold sm:inline-flex">
            <HardHat className="h-4 w-4 text-plate" aria-hidden="true" /> {me}
          </span>
          <Button variant="dark" onClick={lock} className="h-12 px-4">
            <Lock /> Lock
          </Button>
        </div>
      </div>
    </header>
  );

  /* ---------- saved ---------- */
  if (saved) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-navy px-6 text-center text-white">
        <Logo className="h-16 sm:h-20" />
        <CheckCircle2 className="mt-10 h-16 w-16 text-success" aria-hidden="true" />
        <h1 className="mt-5 text-3xl font-bold">Job saved</h1>
        <p className="mt-2 text-slate-300">The owner can see it on the dashboard now.</p>
        <p className="mt-6 rounded-[16px] border border-white/10 bg-white/5 px-8 py-4 font-mono text-4xl font-bold tracking-wider">{saved}</p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button
            size="lg"
            onClick={() => {
              setSaved(null);
              loadAssignments(me);
            }}
          >
            <ClipboardList /> Back to my jobs
          </Button>
          <Button
            size="lg"
            variant="dark"
            onClick={() => {
              setSaved(null);
              lock();
            }}
          >
            <Lock /> Lock
          </Button>
        </div>
      </main>
    );
  }

  /* ---------- my jobs ---------- */
  if (!formOpen) {
    return (
      <div className="min-h-screen bg-page text-[17px]">
        {header}
        <main className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Hi {me}</h1>
              <button type="button" onClick={() => setMe(null)} className="mt-1 text-sm font-semibold text-primary hover:underline">
                Not {me}? Switch person
              </button>
            </div>
            <Button variant="outline" onClick={() => loadAssignments(me)} disabled={loadingList}>
              <RefreshCw className={cn(loadingList && "animate-spin")} /> Refresh
            </Button>
          </div>

          {hasDraft() && (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="mt-6 flex w-full items-center justify-between gap-3 rounded-[16px] border-2 border-dashed border-warning bg-amber-50 p-4 text-left"
            >
              <span>
                <span className="block font-bold text-amber-900">Continue unfinished job sheet</span>
                <span className="text-sm text-amber-800">{[job.rego, job.make, job.model].filter(Boolean).join(" · ") || "Started earlier"}</span>
              </span>
              <ChevronRight className="h-5 w-5 text-amber-800" aria-hidden="true" />
            </button>
          )}

          <h2 className="mt-8 text-xs font-bold uppercase tracking-[0.12em] text-muted">Assigned to you</h2>
          {assignments === null ? (
            <div className="flex items-center gap-2 py-10 text-muted">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : assignments.length === 0 ? (
            <p className="mt-3 rounded-[16px] border border-line bg-white p-6 text-center text-muted">No cars assigned to you right now.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {assignments.map((a) => (
                <li key={a.checkin_id}>
                  <button
                    type="button"
                    onClick={() => openForm(a)}
                    className="group flex w-full items-center gap-4 rounded-[20px] border border-line bg-white p-4 text-left shadow-soft transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 sm:p-5"
                  >
                    <Plate rego={a.rego} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-lg font-bold">{[a.year, a.make, a.model].filter(Boolean).join(" ")}</span>
                      {a.note && (
                        <span className="mt-1 flex gap-1.5 text-[15px] text-ink">
                          <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                          {a.note}
                        </span>
                      )}
                      <span className="mt-1 block text-sm text-muted">
                        Assigned {timeAgo(a.assigned_at ?? a.checked_in_at)} · {a.reference_no}
                      </span>
                    </span>
                    <span className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-primary sm:inline-flex">
                      Start job sheet <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Button variant="outline" size="lg" className="mt-8 w-full" onClick={() => openForm(null)}>
            <FilePlus2 /> Start a blank job sheet
          </Button>
        </main>
      </div>
    );
  }

  /* ---------- form ---------- */
  return (
    <div className="min-h-screen bg-page text-[17px]">
      {header}
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6">
        <button
          type="button"
          onClick={() => {
            setFormOpen(false);
            loadAssignments(me);
          }}
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> My jobs
        </button>
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Job Sheet</h1>
          <p className="mt-1 text-muted">
            {me} · {new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}
          </p>
        </div>

        {from && (
          <div className="mb-6 rounded-[20px] border border-blue-200 bg-blue-50 p-5">
            <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.1em] text-blue-900">
              <Car className="h-4 w-4" aria-hidden="true" /> Assigned car · {from.reference_no}
            </p>
            {from.note ? (
              <p className="mt-2 flex gap-2 text-[17px] text-blue-950">
                <MessageSquareText className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-semibold">Owner&apos;s instructions:</span> {from.note}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-[15px] text-blue-900">Car details are filled in from the check-in – check the KMs.</p>
            )}
          </div>
        )}

        <form onSubmit={onSubmit} noValidate key={formKey}>
          <JobForm
            value={job}
            onChange={onChange}
            mode="staff"
            staffNames={staffNames}
            errors={errors}
            popularMakes={kiosk.quick_makes}
            hideEmployee
          />
          <Button type="submit" size="xl" className="mt-6 h-16 w-full text-[19px] shadow-lg shadow-primary/20" disabled={submitting}>
            {submitting ? <Loader2 className="!size-6 animate-spin" /> : <Send className="!size-5" />}
            {submitting ? "Saving…" : "Save Job Sheet"}
          </Button>
        </form>
      </main>
    </div>
  );
}

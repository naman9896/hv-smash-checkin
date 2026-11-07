"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, ClipboardList, HardHat, Inbox, Link2, Loader2, Plus, Search, Wrench, X } from "lucide-react";
import { Plate, StatusPill } from "@/components/brand";
import { DashboardHeader } from "@/components/dashboard/header";
import { useDashboard } from "@/components/dashboard/shell";
import { Button } from "@/components/ui/button";
import { formatHours } from "@/lib/jobs";
import { STATUS_LABEL, type CheckinStatus, type Job } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

type Filter = "running" | "all" | CheckinStatus;
const FILTERS: Filter[] = ["running", "new", "in_progress", "completed", "cancelled", "all"];
const FILTER_LABEL: Record<Filter, string> = { running: "Running", all: "All", ...STATUS_LABEL };
const isRunning = (j: Job) => j.status === "new" || j.status === "in_progress";

export default function JobsPage() {
  const { jobs, jobsLoading, fresh, unreadJobs, rows } = useDashboard();
  const checkinRef = useMemo(() => new Map(rows.map((r) => [r.id, r.reference_no])), [rows]);
  const [filter, setFilter] = useState<Filter>("running");
  const [query, setQuery] = useState("");
  const [staff, setStaff] = useState("all");
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { running: 0, all: jobs.length, new: 0, in_progress: 0, completed: 0, cancelled: 0 };
    jobs.forEach((j) => {
      c[j.status]++;
      if (isRunning(j)) c.running++;
    });
    return c;
  }, [jobs]);

  const employees = useMemo(() => [...new Set(jobs.map((j) => j.employee_name))].sort(), [jobs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => {
      if (filter === "running" ? !isRunning(j) : filter !== "all" && j.status !== filter) return false;
      if (staff !== "all" && j.employee_name !== staff) return false;
      if (!q) return true;
      return [j.job_no, j.customer_name, j.phone, j.email, j.rego, j.make, j.model, j.employee_name, ...j.work_items]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [jobs, filter, staff, query]);

  const unreadIds = useMemo(() => new Set(unreadJobs.map((j) => j.id)), [unreadJobs]);

  return (
    <div className="min-h-screen bg-page">
      <DashboardHeader />
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Jobs</h1>
            <p className="text-muted">Job sheets from the workshop team. New ones appear here instantly.</p>
          </div>
          <Button asChild>
            <Link href="/dashboard/jobs/new">
              <Plus /> New job
            </Link>
          </Button>
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat label="Running" value={counts.running} icon={<Wrench />} tone="amber" active={filter === "running"} onClick={() => setFilter("running")} />
          <Stat label="New" value={counts.new} icon={<Inbox />} tone="blue" active={filter === "new"} onClick={() => setFilter("new")} />
          <Stat label="Completed" value={counts.completed} icon={<CheckCircle2 />} tone="green" active={filter === "completed"} onClick={() => setFilter("completed")} />
          <Stat label="All Jobs" value={counts.all} icon={<ClipboardList />} tone="ink" active={filter === "all"} onClick={() => setFilter("all")} />
        </div>

        {/* Search + filters */}
        <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search job no, customer, rego, make, work…"
              aria-label="Search jobs"
              className="h-12 w-full rounded-[12px] border border-line bg-white pl-12 pr-10 text-[16px] shadow-soft focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-slate-100"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <HardHat className="h-4 w-4 text-muted" aria-hidden="true" />
            <span className="sr-only">Filter by employee</span>
            <select
              value={staff}
              onChange={(e) => setStaff(e.target.value)}
              className="h-12 rounded-[12px] border border-line bg-white px-3 text-[16px] shadow-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
            >
              <option value="all">All employees</option>
              {employees.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "h-10 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors",
                filter === f ? "border-navy bg-navy text-white" : "border-line bg-white text-ink hover:bg-slate-50",
              )}
            >
              {FILTER_LABEL[f]}
              <span className={cn("ml-1.5 text-xs", filter === f ? "text-slate-300" : "text-muted")}>{counts[f]}</span>
            </button>
          ))}
        </div>

        {/* List */}
        <div className="mt-5 overflow-hidden rounded-[20px] border border-line bg-white shadow-soft">
          {jobsLoading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-muted">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading jobs…
            </div>
          ) : visible.length === 0 ? (
            <div className="py-20 text-center">
              <ClipboardList className="mx-auto h-10 w-10 text-slate-300" aria-hidden="true" />
              <p className="mt-3 font-semibold">{jobs.length ? "No jobs match" : "No jobs yet"}</p>
              <p className="mt-1 text-sm text-muted">
                {jobs.length ? "Try a different search or filter." : "Job sheets saved by staff on the Staff Job Sheet page appear here."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((j) => (
                <li key={j.id} className={cn(fresh.has(j.id) && "row-new")}>
                  <Link
                    href={`/dashboard/jobs/${j.id}`}
                    className="group flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none sm:px-6 md:flex-row md:items-center md:gap-5"
                  >
                    <div className="flex items-center gap-4 md:w-[38%]">
                      <Plate rego={j.rego} />
                      <div className="min-w-0">
                        <p className="truncate font-bold">{[j.year, j.make, j.model].filter(Boolean).join(" ")}</p>
                        <p className="flex items-center gap-2 truncate text-sm text-muted">
                          {j.customer_name ?? <span className="italic">No customer details</span>}
                          {unreadIds.has(j.id) && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                        </p>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="flex items-center gap-1.5 font-semibold">
                        <HardHat className="h-4 w-4 text-muted" aria-hidden="true" />
                        {j.employee_name}
                        {j.hours && <span className="font-normal text-muted">· {formatHours(j.hours)}</span>}
                      </p>
                      <p className="mt-0.5 truncate text-muted">{j.work_items.join(" · ") || "—"}</p>
                      {j.checkin_id && checkinRef.get(j.checkin_id) && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-emerald-700">
                          <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Check-in {checkinRef.get(j.checkin_id)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3 md:w-[210px] md:justify-end">
                      <StatusPill status={j.status} />
                      <span className="text-right text-xs text-muted">
                        <span className="block font-mono">{j.job_no}</span>
                        <time dateTime={j.created_at}>{timeAgo(j.created_at)}</time>
                      </span>
                      <ChevronRight className="hidden h-5 w-5 text-slate-300 group-hover:text-slate-500 md:block" aria-hidden="true" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "ink" | "blue" | "amber" | "green";
  active: boolean;
  onClick: () => void;
}) {
  const tones = { ink: "bg-slate-100 text-slate-700", blue: "bg-blue-50 text-primary", amber: "bg-amber-50 text-amber-600", green: "bg-emerald-50 text-emerald-600" };
  const ring = { ink: "ring-slate-900", blue: "ring-primary", amber: "ring-warning", green: "ring-success" };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center justify-between rounded-[20px] border border-line bg-white p-4 text-left shadow-soft transition-shadow hover:shadow-md sm:p-5",
        active && `ring-2 ${ring[tone]}`,
      )}
    >
      <div>
        <p className="text-sm font-medium text-muted">{label}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-ink">{value}</p>
      </div>
      <span className={cn("flex h-12 w-12 items-center justify-center rounded-[14px] [&_svg]:h-6 [&_svg]:w-6", tones[tone])}>{icon}</span>
    </button>
  );
}

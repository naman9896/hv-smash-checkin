"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, CalendarDays, Car, ChevronRight, Inbox, Loader2, Search, X } from "lucide-react";
import { JobTypeBadge, StatusPill } from "@/components/brand";
import { CheckinDrawer } from "@/components/checkin-drawer";
import { ReturningBadge } from "@/components/dashboard/checkin-detail";
import { DashboardHeader } from "@/components/dashboard/header";
import { useDashboard } from "@/components/dashboard/shell";
import { Switch } from "@/components/ui/switch";
import { STATUS_LABEL, type Checkin, type CheckinStatus } from "@/lib/types";
import { cn, formatAuPhone, rangeBounds, timeAgo, vehicleTitle, type DateRange } from "@/lib/utils";

type Filter = "all" | CheckinStatus;
const FILTERS: Filter[] = ["all", "new", "in_progress", "completed", "cancelled"];
const RANGES: { value: DateRange; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom" },
];

export default function DashboardPage() {
  const { rows, loading, fresh, unread, selectedId, openCheckin, showArchived, setShowArchived } = useDashboard();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [range, setRange] = useState<DateRange>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [, tick] = useState(0);

  // keep "x min ago" fresh
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Close the drawer when leaving the page
  useEffect(() => () => openCheckin(null), [openCheckin]);

  /* ---------- derived ---------- */
  const inScope = useMemo(() => {
    const { from, to } = rangeBounds(range, customFrom, customTo);
    return rows.filter((r) => {
      if (!showArchived && r.is_archived) return false;
      const t = new Date(r.created_at);
      if (from && t < from) return false;
      if (to && t >= to) return false;
      return true;
    });
  }, [rows, range, customFrom, customTo, showArchived]);

  const counts = useMemo(() => {
    const c = { all: inScope.length, new: 0, in_progress: 0, completed: 0, cancelled: 0 };
    inScope.forEach((r) => c[r.status]++);
    return c;
  }, [inScope]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return inScope.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!q) return true;
      const hay = [r.customer_name, r.email, r.rego ?? "", r.make, r.model, r.reference_no, r.insurance_company ?? "", r.claim_number ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q) || (qDigits.length >= 3 && r.phone.replace(/\D/g, "").includes(qDigits));
    });
  }, [inScope, query, filter]);

  /** Returning if the database flagged it, or an older loaded check-in shares the phone or email. */
  const returning = useMemo(() => {
    const ids = new Set<string>();
    const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const seen = new Set<string>();
    for (const r of sorted) {
      if (r.returning_customer || seen.has(r.phone) || seen.has(r.email)) ids.add(r.id);
      seen.add(r.phone);
      seen.add(r.email);
    }
    return ids;
  }, [rows]);

  const unreadIds = useMemo(() => new Set(unread.map((u) => u.id)), [unread]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="min-h-screen bg-page">
      <DashboardHeader />

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
        {/* Stats */}
        <h1 className="sr-only">Dashboard</h1>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard label="All check-ins" value={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
          <StatCard label="New" value={counts.new} dot="bg-primary" active={filter === "new"} onClick={() => setFilter("new")} />
          <StatCard label="In progress" value={counts.in_progress} dot="bg-warning" active={filter === "in_progress"} onClick={() => setFilter("in_progress")} />
          <StatCard label="Completed" value={counts.completed} dot="bg-success" active={filter === "completed"} onClick={() => setFilter("completed")} />
        </div>

        {/* Search + filters */}
        <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, phone, rego, vehicle or claim number"
              aria-label="Search check-ins"
              className="h-12 w-full rounded-[12px] border border-line bg-white pl-12 pr-10 text-[16px] focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[8px] text-muted hover:bg-slate-100"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
            <div className={SEGMENTED} role="group" aria-label="Filter by status">
              {FILTERS.map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={segment(filter === f)}>
                  {f === "all" ? "All" : STATUS_LABEL[f]}
                  <span className={cn("ml-1.5 font-mono text-xs tabular-nums", filter === f ? "text-slate-300" : "text-muted")}>{counts[f]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Date range + archived */}
        <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted" aria-hidden="true" />
            <div className={SEGMENTED} role="group" aria-label="Filter by date">
              {RANGES.map((r) => (
                <button key={r.value} type="button" aria-pressed={range === r.value} onClick={() => setRange(r.value)} className={segment(range === r.value)}>
                  {r.label}
                </button>
              ))}
            </div>
            {range === "custom" && (
              <span className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="range-from">
                  From date
                </label>
                <input
                  id="range-from"
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-10 rounded-[10px] border border-line bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
                />
                <span className="text-sm text-muted">to</span>
                <label className="sr-only" htmlFor="range-to">
                  To date
                </label>
                <input
                  id="range-to"
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-10 rounded-[10px] border border-line bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
                />
              </span>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <Archive className="h-4 w-4 text-muted" aria-hidden="true" />
            Show archived
            <Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="Show archived check-ins" />
          </label>
        </div>

        {/* List */}
        <div className="mt-4 overflow-hidden rounded-[16px] border border-line bg-white">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-muted">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading check-ins…
            </div>
          ) : visible.length === 0 ? (
            <div className="py-20 text-center">
              <Inbox className="mx-auto h-10 w-10 text-slate-300" aria-hidden="true" />
              <p className="mt-3 font-medium">{rows.length ? "No check-ins match" : "No check-ins yet"}</p>
              <p className="mt-1 text-sm text-muted">
                {rows.length ? "Try a different search, status or date range" : "New check-ins from the iPad appear here as they're submitted"}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((c) => (
                <Row key={c.id} c={c} fresh={fresh.has(c.id)} unread={unreadIds.has(c.id)} returning={returning.has(c.id)} onOpen={() => openCheckin(c.id)} />
              ))}
            </ul>
          )}
        </div>
      </main>

      <CheckinDrawer checkin={selected} onOpenChange={(o) => !o && openCheckin(null)} />
    </div>
  );
}

function Row({
  c,
  fresh,
  unread,
  returning,
  onOpen,
}: {
  c: Checkin;
  fresh: boolean;
  unread: boolean;
  returning: boolean;
  onOpen: () => void;
}) {
  return (
    <li className={cn(fresh && "row-new", c.is_archived && "opacity-70")}>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full flex-col gap-3 px-4 py-4 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none sm:px-6 md:flex-row md:items-center md:gap-6"
      >
        <div className="min-w-0 md:w-[36%]">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
            {c.customer_name}
            {unread && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
            {returning && <ReturningBadge />}
          </p>
          <p className="mt-1 flex min-w-0 gap-2 text-sm text-muted">
            <span className="shrink-0 tabular-nums">{formatAuPhone(c.phone)}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{c.email}</span>
          </p>
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
            {c.rego ? <Plate rego={c.rego} /> : <Car className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
            {vehicleTitle(c)}
            <JobTypeBadge type={c.job_type} />
          </p>
          {(c.insurance_company || c.claim_number) && (
            <p className="mt-1 flex flex-wrap gap-x-3 text-muted">
              {c.insurance_company && <span>{c.insurance_company}</span>}
              {c.claim_number && <span className="font-mono">Claim #{c.claim_number}</span>}
            </p>
          )}
          {c.damage_description && (
            <p className="mt-1 truncate text-muted">{c.damage_description}</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 md:w-[210px] md:justify-end">
          <StatusPill status={c.status} />
          <span className="text-right text-xs text-muted">
            <span className="block font-mono tabular-nums">{c.reference_no}</span>
            <time dateTime={c.created_at}>{timeAgo(c.created_at)}</time>
          </span>
          <ChevronRight className="hidden h-5 w-5 text-slate-300 group-hover:text-slate-500 md:block" aria-hidden="true" />
        </div>
      </button>
    </li>
  );
}

/** The car's number plate: the thing a workshop looks a job up by. */
function Plate({ rego }: { rego: string }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center rounded-[4px] border border-ink/25 bg-white px-2 font-mono text-xs font-semibold tracking-wider text-ink shadow-[inset_0_-1px_0_rgb(0_0_0/0.06)]">
      {rego}
    </span>
  );
}

const SEGMENTED = "inline-flex shrink-0 gap-1 rounded-[12px] border border-line bg-white p-1";
const segment = (active: boolean) =>
  cn(
    "h-8 shrink-0 whitespace-nowrap rounded-[8px] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20",
    active ? "bg-navy text-white" : "text-ink hover:bg-slate-100",
  );

function StatCard({
  label,
  value,
  dot,
  active,
  onClick,
}: {
  label: string;
  value: number;
  /** Status colour, matching the status pills. None for the "all" card. */
  dot?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-[16px] border bg-white p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20",
        active ? "border-primary ring-1 ring-primary" : "border-line hover:border-ink/20 hover:bg-slate-50",
      )}
    >
      <p className="flex items-center gap-2 text-sm text-muted">
        {dot && <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden="true" />}
        {label}
      </p>
      <p className="mt-2 text-3xl font-medium tabular-nums text-ink">{value}</p>
    </button>
  );
}

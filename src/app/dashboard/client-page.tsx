"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, CalendarDays, Car, CheckCircle2, ChevronRight, ClipboardList, FileText, Inbox, Loader2, Mail, Phone, Search, Wrench, X } from "lucide-react";
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
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
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
      const hay = [r.customer_name, r.email, r.make, r.model, r.reference_no, r.insurance_company ?? "", r.claim_number ?? ""]
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
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard label="All Check-ins" value={counts.all} icon={<ClipboardList />} tone="ink" active={filter === "all"} onClick={() => setFilter("all")} />
          <StatCard label="New" value={counts.new} icon={<Inbox />} tone="blue" active={filter === "new"} onClick={() => setFilter("new")} />
          <StatCard label="In Progress" value={counts.in_progress} icon={<Wrench />} tone="amber" active={filter === "in_progress"} onClick={() => setFilter("in_progress")} />
          <StatCard label="Completed" value={counts.completed} icon={<CheckCircle2 />} tone="green" active={filter === "completed"} onClick={() => setFilter("completed")} />
        </div>

        {/* Search + filters */}
        <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, phone, email, make, model or claim number"
              aria-label="Search check-ins"
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
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0 lg:pb-0" role="group" aria-label="Filter by status">
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
                {f === "all" ? "All" : STATUS_LABEL[f]}
                <span className={cn("ml-1.5 text-xs", filter === f ? "text-slate-300" : "text-muted")}>{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Date range + archived */}
        <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by date">
            <CalendarDays className="h-4 w-4 text-muted" aria-hidden="true" />
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={range === r.value}
                onClick={() => setRange(r.value)}
                className={cn(
                  "h-9 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                  range === r.value ? "border-primary bg-primary/10 text-primary" : "border-line bg-white text-ink hover:bg-slate-50",
                )}
              >
                {r.label}
              </button>
            ))}
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
                  className="h-9 rounded-[10px] border border-line bg-white px-2.5 text-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
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
                  className="h-9 rounded-[10px] border border-line bg-white px-2.5 text-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
                />
              </span>
            )}
          </div>
          <label className="flex items-center gap-2.5 text-sm font-semibold text-ink">
            <Archive className="h-4 w-4 text-muted" aria-hidden="true" />
            Show archived
            <Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="Show archived check-ins" />
          </label>
        </div>

        {/* List */}
        <div className="mt-5 overflow-hidden rounded-[20px] border border-line bg-white shadow-soft">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-muted">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading check-ins…
            </div>
          ) : visible.length === 0 ? (
            <div className="py-20 text-center">
              <Inbox className="mx-auto h-10 w-10 text-slate-300" aria-hidden="true" />
              <p className="mt-3 font-semibold">{rows.length ? "No check-ins match" : "No check-ins yet"}</p>
              <p className="mt-1 text-sm text-muted">
                {rows.length ? "Try a different search, status or date range." : "New check-ins from the iPad appear here instantly."}
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
        className="group flex w-full flex-col gap-3 px-4 py-4 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none sm:px-6 md:flex-row md:items-center md:gap-5"
      >
        <div className="min-w-0 md:w-[38%]">
          <p className="flex flex-wrap items-center gap-2 font-bold text-ink">
            {c.customer_name}
            {unread && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
            {returning && <ReturningBadge />}
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted">
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              {formatAuPhone(c.phone)}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1">
              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{c.email}</span>
            </span>
          </p>
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
            <Car className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            {vehicleTitle(c)}
            <JobTypeBadge type={c.job_type} />
          </p>
          {(c.insurance_company || c.claim_number) && (
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-muted">
              {c.insurance_company && <span>{c.insurance_company}</span>}
              {c.claim_number && <span className="font-mono">Claim #{c.claim_number}</span>}
            </p>
          )}
          {c.damage_description && (
            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-muted">
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{c.damage_description}</span>
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 md:w-[210px] md:justify-end">
          <StatusPill status={c.status} />
          <span className="text-right text-xs text-muted">
            <span className="block font-mono">{c.reference_no}</span>
            <time dateTime={c.created_at}>{timeAgo(c.created_at)}</time>
          </span>
          <ChevronRight className="hidden h-5 w-5 text-slate-300 group-hover:text-slate-500 md:block" aria-hidden="true" />
        </div>
      </button>
    </li>
  );
}

function StatCard({
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
  const tones = {
    ink: "bg-slate-100 text-slate-700",
    blue: "bg-primary/10 text-primary",
    amber: "bg-amber-50 text-amber-600",
    green: "bg-emerald-50 text-emerald-600",
  };
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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, ChevronRight as Go, Loader2, Plus, Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Plate } from "@/components/brand";
import { BookingStatusPill, NotArrivedPill, SmsBadge } from "@/components/booking/owner/bits";
import { SendLinkDialog } from "@/components/booking/owner/dialogs";
import { DashboardHeader } from "@/components/dashboard/header";
import { useDashboard } from "@/components/dashboard/shell";
import { Button } from "@/components/ui/button";
import { formatDayLong, formatWindow } from "@/lib/booking/format";
import { addDays, isNotArrived, smsSummary, sydneyNow } from "@/lib/booking/owner";
import {
  dayAvailability, listBookingsOn, listSmsFor, noShowCounts, subscribeBookings, subscribeSms,
  type Booking, type BookingSms, type DayAvailability,
} from "@/lib/booking/owner-data";
import { cn } from "@/lib/utils";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE_FIRST: Record<Booking["status"], number> = { booked: 0, arrived: 0, completed: 0, no_show: 1, cancelled: 2 };

export default function BookingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { unreadBookings } = useDashboard();
  const [now, setNow] = useState(() => sydneyNow());
  const q = params.get("date");
  const date = q && ISO.test(q) ? q : now.date;

  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [sms, setSms] = useState<BookingSms[]>([]);
  const [noShows, setNoShows] = useState<Map<string, number>>(new Map());
  const [day, setDay] = useState<DayAvailability | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  // Clock for "Not arrived" (17:00) and for "today"
  useEffect(() => {
    const t = setInterval(() => setNow(sydneyNow()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async (d: string) => {
    try {
      const [rows, avail] = await Promise.all([listBookingsOn(d), dayAvailability(d)]);
      const [texts, counts] = await Promise.all([listSmsFor(rows.map((r) => r.id)), noShowCounts(rows.map((r) => r.mobile))]);
      setBookings(rows);
      setDay(avail);
      setSms(texts);
      setNoShows(counts);
      setLoadedFor(d);
    } catch (e) {
      toast.error("Couldn't load bookings", { description: e instanceof Error ? e.message : undefined });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listBookingsOn(date), dayAvailability(date)])
      .then(async ([rows, avail]) => {
        const [texts, counts] = await Promise.all([listSmsFor(rows.map((r) => r.id)), noShowCounts(rows.map((r) => r.mobile))]);
        if (cancelled) return;
        setBookings(rows);
        setDay(avail);
        setSms(texts);
        setNoShows(counts);
        setLoadedFor(date);
      })
      .catch((e) => toast.error("Couldn't load bookings", { description: e instanceof Error ? e.message : undefined }));
    return () => {
      cancelled = true;
    };
  }, [date]);

  // Live: any booking or SMS change for this day → reload the day (small lists)
  useEffect(() => {
    const touches = (b: { drop_off_date?: string }) => b.drop_off_date === date;
    const unsubB = subscribeBookings({
      onInsert: (b) => touches(b) && load(date),
      onUpdate: () => load(date), // a booking may have moved to or from this day
      onDelete: () => load(date),
    });
    const unsubS = subscribeSms(() => load(date));
    return () => {
      unsubB();
      unsubS();
    };
  }, [date, load]);

  const go = (d: string) => router.replace(d === now.date ? pathname : `${pathname}?date=${d}`, { scroll: false });

  const unreadIds = useMemo(() => new Set(unreadBookings.map((b) => b.id)), [unreadBookings]);
  const smsBy = useMemo(() => {
    const m = new Map<string, BookingSms[]>();
    sms.forEach((s) => s.booking_id && m.set(s.booking_id, [...(m.get(s.booking_id) ?? []), s]));
    return m;
  }, [sms]);
  const sorted = useMemo(
    () => [...(bookings ?? [])].sort((a, b) => ACTIVE_FIRST[a.status] - ACTIVE_FIRST[b.status]),
    [bookings],
  );
  const loading = loadedFor !== date;
  const tomorrow = addDays(now.date, 1);

  return (
    <div className="min-h-screen bg-page">
      <DashboardHeader />
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Bookings</h1>
            <p className="text-muted">Cars booked in to drop off. New online bookings appear here instantly.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setLinkOpen(true)}>
              <Send /> Send booking link
            </Button>
            <Button asChild>
              <Link href="/dashboard/bookings/new">
                <Plus /> New booking
              </Link>
            </Button>
          </div>
        </div>

        {/* Day picker */}
        <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label="Choose a day">
          <DayButton active={date === now.date} onClick={() => go(now.date)}>Today</DayButton>
          <DayButton active={date === tomorrow} onClick={() => go(tomorrow)}>Tomorrow</DayButton>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => go(addDays(date, -1))} aria-label="Previous day">
              <ChevronLeft />
            </Button>
            <label className="relative">
              <span className="sr-only">Pick a date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => ISO.test(e.target.value) && go(e.target.value)}
                className="h-11 rounded-[12px] border border-line bg-white px-3 text-[16px] shadow-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
              />
            </label>
            <Button variant="outline" size="icon" onClick={() => go(addDays(date, 1))} aria-label="Next day">
              <ChevronRight />
            </Button>
          </div>
        </div>

        {/* Day summary */}
        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">{formatDayLong(date)}</h2>
          {day && !loading && <DaySummary day={day} />}
        </div>

        {/* List */}
        <div className="mt-3 overflow-hidden rounded-[20px] border border-line bg-white shadow-soft">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-muted">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading bookings…
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-20 text-center">
              <CalendarDays className="mx-auto h-10 w-10 text-slate-300" aria-hidden="true" />
              <p className="mt-3 font-semibold">No bookings for this day</p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {sorted.map((b) => {
                const inactive = b.status === "cancelled" || b.status === "no_show";
                return (
                  <li key={b.id} className={cn(inactive && "bg-slate-50/60")}>
                    <Link
                      href={`/dashboard/bookings/${b.id}`}
                      className="group flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none sm:px-6 md:flex-row md:items-center md:gap-5"
                    >
                      <div className={cn("flex items-center gap-4 md:w-[36%]", inactive && "opacity-60")}>
                        <Plate rego={b.rego} />
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate font-bold">
                            {b.first_name} {b.last_name}
                            {unreadIds.has(b.id) && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="New" />}
                          </p>
                          <p className="truncate text-sm text-muted">{[b.year, b.make, b.model].filter(Boolean).join(" ")}</p>
                        </div>
                      </div>
                      <div className={cn("min-w-0 flex-1 text-sm", inactive && "opacity-60")}>
                        <p className="truncate font-semibold">{b.booking_items.map((i) => i.name_snapshot).join(" · ")}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
                          <span>Drop off {formatWindow(b.window_start, b.window_end)}</span>
                          <SmsBadge summary={smsSummary(smsBy.get(b.id) ?? [])} />
                          <NoShowNote count={(noShows.get(b.mobile) ?? 0) - (b.status === "no_show" ? 1 : 0)} />
                          {b.over_capacity && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                              <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /> Overbooked
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3 md:w-[240px] md:justify-end">
                        <span className="flex flex-wrap items-center gap-2">
                          <BookingStatusPill status={b.status} />
                          {isNotArrived(b, now) && <NotArrivedPill />}
                        </span>
                        <span className="text-right text-xs text-muted">
                          <span className="block font-mono">{b.reference_no}</span>
                          {b.source === "online" ? "Online" : "Owner"}
                        </span>
                        <Go className="hidden h-5 w-5 text-slate-300 group-hover:text-slate-500 md:block" aria-hidden="true" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
      <SendLinkDialog open={linkOpen} onOpenChange={setLinkOpen} />
    </div>
  );
}

function DayButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-11 rounded-full border px-4 text-sm font-semibold transition-colors",
        active ? "border-navy bg-navy text-white" : "border-line bg-white text-ink hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

const CLOSED_WHY: Record<string, string> = { holiday: "Public holiday", weekly: "Closed this weekday", override: "You closed this day", past: "" };

function DaySummary({ day }: { day: DayAvailability }) {
  if (day.status === "closed" && day.reason !== "past") {
    return (
      <p className="text-sm font-semibold text-muted">
        Closed · {day.note ?? CLOSED_WHY[day.reason ?? ""] ?? "Closed"}
        {day.booked > 0 && ` · ${day.booked} booked`}
      </p>
    );
  }
  return (
    <p className={cn("text-sm font-semibold", day.booked >= day.capacity ? "text-red-700" : "text-muted")}>
      {day.booked} of {day.capacity} booked
      {day.reason !== "past" && (day.booked >= day.capacity ? " · Full" : ` · ${day.capacity - day.booked} left`)}
    </p>
  );
}

/** Earlier no-shows with this mobile (BUSINESS_RULES §9: staff see the count). */
function NoShowNote({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
      <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /> {count === 1 ? "1 no-show" : `${count} no-shows`} before
    </span>
  );
}

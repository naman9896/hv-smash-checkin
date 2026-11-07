"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CalendarX, Link2, Loader2, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { formatDay, formatWindow } from "@/lib/booking/format";
import { sydneyNow } from "@/lib/booking/owner";
import {
  cancelBooking, dayAvailability, linkCheckin, listWindows, rescheduleBooking, sendBookingLink, type Booking, type DayAvailability,
} from "@/lib/booking/owner-data";
import { normaliseMobile } from "@/lib/booking/schemas";
import type { Checkin } from "@/lib/types";
import { cn } from "@/lib/utils";

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void; booking: Booking; onDone: () => void };

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border border-line p-3 text-left text-[15px]">
      <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--color-primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function useAction(onDone: () => void, close: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go(action: () => Promise<void>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast.success(done);
      close();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, go, setError };
}

export function CancelDialog({ open, onOpenChange, booking, onDone }: DialogProps) {
  const [notify, setNotify] = useState(true);
  const { busy, error, go } = useAction(onDone, () => onOpenChange(false));
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Cancel this booking?"
      description={`${booking.first_name} ${booking.last_name} · ${booking.rego} · ${formatDay(booking.drop_off_date)}`}
      icon={<CalendarX className="text-red-600" />}
    >
      <div className="mt-6 space-y-4 text-left">
        <Check checked={notify} onChange={setNotify}>
          Text the customer that it&apos;s cancelled
        </Check>
        {error && <p role="alert" className="rounded-[12px] bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button variant="destructive" className="sm:flex-1" disabled={busy} onClick={() => go(() => cancelBooking(booking.id, notify), "Booking cancelled")}>
            {busy && <Loader2 className="animate-spin" />} Cancel booking
          </Button>
          <Button variant="outline" className="sm:flex-1" disabled={busy} onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function RescheduleDialog({ open, onOpenChange, booking, onDone }: DialogProps) {
  const today = sydneyNow().date;
  const [date, setDate] = useState(booking.drop_off_date);
  const [windows, setWindows] = useState<{ id: string; start_time: string; end_time: string }[]>([]);
  const [windowId, setWindowId] = useState<string>("");
  const [day, setDay] = useState<DayAvailability | null>(null);
  const [over, setOver] = useState(false);
  const [notify, setNotify] = useState(true);
  const { busy, error, go, setError } = useAction(onDone, () => onOpenChange(false));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listWindows()
      .then((w) => {
        if (cancelled) return;
        setWindows(w);
        setWindowId((cur) => cur || (w.some((x) => x.id === booking.window_id) ? booking.window_id! : w[0]?.id) || "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, booking.window_id]);

  useEffect(() => {
    if (!open || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let cancelled = false;
    dayAvailability(date)
      .then((d) => !cancelled && setDay(d))
      .catch(() => !cancelled && setDay(null));
    return () => {
      cancelled = true;
    };
  }, [open, date]);

  const sameDay = date === booking.drop_off_date;
  const full = !sameDay && day?.status === "full";
  const closed = day?.status === "closed";

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Move to another day"
      description={`${booking.rego} is booked for ${formatDay(booking.drop_off_date)}.`}
      icon={<CalendarClock className="text-primary" />}
    >
      <div className="mt-6 space-y-4 text-left">
        <label className="block">
          <span className="text-sm font-semibold">New drop-off day</span>
          <input
            type="date"
            min={today}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setOver(false);
              setError(null);
            }}
            className="mt-1 h-12 w-full rounded-[12px] border border-line bg-white px-3 text-[16px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
          />
        </label>
        {windows.length > 1 && (
          <label className="block">
            <span className="text-sm font-semibold">Drop-off time</span>
            <select
              value={windowId}
              onChange={(e) => setWindowId(e.target.value)}
              className="mt-1 h-12 w-full rounded-[12px] border border-line bg-white px-3 text-[16px]"
            >
              {windows.map((w) => (
                <option key={w.id} value={w.id}>{formatWindow(w.start_time, w.end_time)}</option>
              ))}
            </select>
          </label>
        )}
        {day && !sameDay && (
          <p className={cn("rounded-[12px] px-3 py-2 text-sm font-semibold", closed || full ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800")} role="status">
            {closed
              ? day.reason === "past" ? "That day has passed." : `Closed${day.note ? `: ${day.note}` : ""}`
              : full
                ? `Full: ${day.booked} of ${day.capacity} booked`
                : `${day.spots_left} of ${day.capacity} spots left`}
          </p>
        )}
        {full && (
          <Check checked={over} onChange={setOver}>
            Overbook: take this car anyway
          </Check>
        )}
        <Check checked={notify} onChange={setNotify}>
          Text the customer the new day
        </Check>
        {error && <p role="alert" className="rounded-[12px] bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            className="sm:flex-1"
            disabled={busy || !windowId || closed || (full && !over) || (sameDay && windowId === booking.window_id)}
            onClick={() => go(() => rescheduleBooking(booking.id, date, windowId, over, notify), `Moved to ${formatDay(date)}`)}
          >
            {busy && <Loader2 className="animate-spin" />} Move booking
          </Button>
          <Button variant="outline" className="sm:flex-1" disabled={busy} onClick={() => onOpenChange(false)}>
            Back
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const plain = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function LinkCheckinDialog({ open, onOpenChange, booking, onDone, checkins }: DialogProps & { checkins: Checkin[] }) {
  const [query, setQuery] = useState("");
  const { busy, error, go } = useAction(onDone, () => onOpenChange(false));

  // Same rego first, then check-ins from the drop-off day, then the rest (newest first)
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rank = (c: Checkin) =>
      plain(c.rego) === plain(booking.rego) ? 0 : sydneyNow(new Date(c.created_at)).date === booking.drop_off_date ? 1 : 2;
    return checkins
      .filter((c) => c.status !== "cancelled")
      .filter((c) => !q || `${c.reference_no} ${c.rego} ${c.first_name} ${c.last_name}`.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || b.created_at.localeCompare(a.created_at))
      .slice(0, 20);
  }, [checkins, query, booking.rego, booking.drop_off_date]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Link a kiosk check-in"
      description={booking.status === "booked" ? "Linking marks the booking as arrived." : undefined}
      icon={<Link2 className="text-primary" />}
      className="max-w-lg"
    >
      <div className="mt-6 space-y-3 text-left">
        <label className="relative block">
          <span className="sr-only">Search check-ins</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search rego, name or SMW number"
            className="h-12 w-full rounded-[12px] border border-line bg-white pl-9 pr-3 text-[16px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
          />
        </label>
        {error && <p role="alert" className="rounded-[12px] bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
        <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-[12px] border border-line">
          {candidates.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No check-ins found.</li>}
          {candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => go(() => linkCheckin(booking.id, c.id), `Linked ${c.reference_no}`)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    <span className="font-mono">{c.rego}</span> · {c.first_name} {c.last_name}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {c.reference_no} · {c.make} {c.model}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted">{formatDay(sydneyNow(new Date(c.created_at)).date)}</span>
              </button>
            </li>
          ))}
        </ul>
        <Button variant="outline" className="w-full" disabled={busy} onClick={() => onOpenChange(false)}>
          Back
        </Button>
      </div>
    </Modal>
  );
}

/** Option B: text a customer the booking page (5 per mobile per day). */
export function SendLinkDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [mobile, setMobile] = useState("");
  const { busy, error, go, setError } = useAction(() => setMobile(""), () => onOpenChange(false));
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Send booking link"
      description="Texts the customer a link to book online."
      icon={<Send className="text-primary" />}
    >
      <form
        className="mt-6 space-y-4 text-left"
        onSubmit={(e) => {
          e.preventDefault();
          if (!normaliseMobile(mobile)) return setError("Enter an Australian mobile, e.g. 0412 345 678.");
          go(() => sendBookingLink(mobile), "Booking link sent");
        }}
      >
        <label className="block">
          <span className="text-sm font-semibold">Customer mobile</span>
          <input
            type="tel"
            inputMode="tel"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="0412 345 678"
            className="mt-1 h-12 w-full rounded-[12px] border border-line bg-white px-3 text-[16px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
          />
        </label>
        {error && <p role="alert" className="rounded-[12px] bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="submit" className="sm:flex-1" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Send link
          </Button>
          <Button type="button" variant="outline" className="sm:flex-1" disabled={busy} onClick={() => onOpenChange(false)}>
            Back
          </Button>
        </div>
      </form>
    </Modal>
  );
}

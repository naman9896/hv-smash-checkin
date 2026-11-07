"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle, CalendarClock, CalendarX, Link2, Loader2, Mail, Phone, RefreshCw, RotateCcw, TriangleAlert, Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { Plate } from "@/components/brand";
import { BookingStatusPill, NotArrivedPill } from "@/components/booking/owner/bits";
import { CancelDialog, LinkCheckinDialog, RescheduleDialog } from "@/components/booking/owner/dialogs";
import { ReadySmsButton } from "@/components/booking/owner/ready-sms";
import { DashboardHeader } from "@/components/dashboard/header";
import { useDashboard } from "@/components/dashboard/shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDay, formatDayLong, formatPrice, formatWindow, telHref } from "@/lib/booking/format";
import {
  isNotArrived, SMS_STATUS_LABEL, SMS_TEMPLATE_LABEL, statusActions, sydneyNow, type StatusAction,
} from "@/lib/booking/owner";
import {
  getBooking, linkCheckin, listEvents, listSmsFor, noShowCount, retrySms, saveOwnerNotes, sendReadySms, setBookingStatus, subscribeBookings, subscribeSms,
  type Booking, type BookingEvent, type BookingSms,
} from "@/lib/booking/owner-data";
import { cn, formatAuMobile, formatDateTime } from "@/lib/utils";

const MAX_OWNER_NOTES = 2000;

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const { markBookingRead, unreadBookings, rows: checkins, openCheckin } = useDashboard();
  const [booking, setBooking] = useState<Booking | null | undefined>(undefined);
  const [sms, setSms] = useState<BookingSms[]>([]);
  const [events, setEvents] = useState<BookingEvent[]>([]);
  const [noShows, setNoShows] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"cancel" | "reschedule" | "link" | null>(null);
  const now = sydneyNow();

  const load = useCallback(async () => {
    try {
      const b = await getBooking(id);
      setBooking(b);
      if (!b) return;
      const [texts, history, count] = await Promise.all([listSmsFor([b.id]), listEvents(b.id), noShowCount(b.mobile, b.id)]);
      setSms(texts);
      setEvents(history);
      setNoShows(count);
    } catch (e) {
      toast.error("Couldn't load the booking", { description: e instanceof Error ? e.message : undefined });
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    getBooking(id)
      .then(async (b) => {
        if (cancelled) return;
        setBooking(b);
        if (!b) return;
        const [texts, history, count] = await Promise.all([listSmsFor([b.id]), listEvents(b.id), noShowCount(b.mobile, b.id)]);
        if (cancelled) return;
        setSms(texts);
        setEvents(history);
        setNoShows(count);
      })
      .catch((e) => toast.error("Couldn't load the booking", { description: e instanceof Error ? e.message : undefined }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Opening a booking marks it read
  const unread = unreadBookings.some((b) => b.id === id);
  useEffect(() => {
    if (unread) markBookingRead(id);
  }, [unread, id, markBookingRead]);

  // Live updates (another device, the dispatcher sending its SMS)
  useEffect(() => {
    const unsubB = subscribeBookings({ onUpdate: (b) => b.id === id && load(), onDelete: (x) => x === id && setBooking(null) });
    const unsubS = subscribeSms((s) => s.booking_id === id && load());
    return () => {
      unsubB();
      unsubS();
    };
  }, [id, load]);

  async function run(key: string, action: () => Promise<void>, done: string) {
    setBusy(key);
    try {
      await action();
      toast.success(done);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const linked = useMemo(() => checkins.find((c) => c.id === booking?.checkin_id) ?? null, [checkins, booking?.checkin_id]);

  return (
    <div className="min-h-screen bg-page">
      <DashboardHeader
        back={{
          href: booking ? `/dashboard/bookings?date=${booking.drop_off_date}` : "/dashboard/bookings",
          label: booking ? `Bookings for ${formatDay(booking.drop_off_date)}` : "Bookings",
        }}
      />
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        {booking === undefined && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading booking…
          </div>
        )}
        {booking === null && <p className="py-20 text-center font-semibold">This booking doesn&apos;t exist or was deleted.</p>}
        {booking && (
          <div className="space-y-5">
            {/* Summary */}
            <section className="rounded-[20px] border border-line bg-white p-5 shadow-soft sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm text-muted">{booking.reference_no}</p>
                  <h1 className="mt-1 text-2xl font-bold">
                    {booking.first_name} {booking.last_name}
                  </h1>
                </div>
                <span className="flex flex-wrap items-center gap-2">
                  <BookingStatusPill status={booking.status} />
                  {isNotArrived(booking, now) && <NotArrivedPill />}
                </span>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-4">
                <Plate rego={booking.rego} />
                <div>
                  <p className="font-bold">{[booking.year, booking.make, booking.model].filter(Boolean).join(" ")}</p>
                  <p className="text-sm text-muted">{booking.rego_state}</p>
                </div>
              </div>
              <dl className="mt-5 grid gap-3 text-[15px] sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted">Drop off</dt>
                  <dd className="font-semibold">
                    {formatDayLong(booking.drop_off_date)}, {formatWindow(booking.window_start, booking.window_end)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">Booked</dt>
                  <dd className="font-semibold">
                    {booking.source === "online" ? "Online" : "By you"} · {formatDateTime(booking.created_at)}
                  </dd>
                </div>
              </dl>
              {booking.over_capacity && (
                <p className="mt-4 flex items-center gap-2 rounded-[12px] bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                  <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" /> Overbooked: this day was already full.
                </p>
              )}
              {noShows > 0 && (
                <p className="mt-3 flex items-center gap-2 rounded-[12px] bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {noShows === 1 ? "1 earlier no-show" : `${noShows} earlier no-shows`} with this mobile
                </p>
              )}

              {/* Actions */}
              <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-5">
                {statusActions(booking.status, booking.drop_off_date, now.date).map((a: StatusAction) => (
                  <Button
                    key={a.to}
                    variant={a.undo ? "outline" : a.to === "no_show" ? "outline" : "default"}
                    disabled={busy !== null}
                    onClick={() => run(a.to, () => setBookingStatus(booking.id, a.to), a.undo ? "Undone" : "Saved")}
                  >
                    {busy === a.to ? <Loader2 className="animate-spin" /> : a.undo ? <RotateCcw /> : null}
                    {a.label}
                  </Button>
                ))}
                {booking.status === "booked" && (
                  <>
                    <Button variant="outline" disabled={busy !== null} onClick={() => setDialog("reschedule")}>
                      <CalendarClock /> Reschedule
                    </Button>
                    <Button variant="outline" disabled={busy !== null} onClick={() => setDialog("cancel")} className="text-red-700">
                      <CalendarX /> Cancel booking
                    </Button>
                  </>
                )}
              </div>
              {(booking.status === "arrived" || booking.status === "completed") && (
                <ReadySmsButton className="mt-4" send={(resend) => sendReadySms(booking.id, resend)} onSent={load} />
              )}
            </section>

            {/* Customer */}
            <section className="rounded-[20px] border border-line bg-white p-5 shadow-soft sm:p-6">
              <h2 className="text-lg font-bold">Customer</h2>
              <ul className="mt-3 space-y-2 text-[15px]">
                <li>
                  <a href={telHref(booking.mobile)} className="inline-flex items-center gap-2 font-semibold text-primary hover:underline">
                    <Phone className="h-4 w-4" aria-hidden="true" /> {formatAuMobile(booking.mobile)}
                  </a>
                </li>
                {booking.email && (
                  <li>
                    <a href={`mailto:${booking.email}`} className="inline-flex items-center gap-2 text-primary hover:underline">
                      <Mail className="h-4 w-4" aria-hidden="true" /> {booking.email}
                    </a>
                  </li>
                )}
              </ul>
              <h3 className="mt-5 text-sm font-semibold text-muted">Services</h3>
              <ul className="mt-1 divide-y divide-line">
                {booking.booking_items.map((i) => (
                  <li key={i.service_id} className="flex justify-between gap-3 py-2 text-[15px]">
                    <span>{i.name_snapshot}</span>
                    <span className="text-muted">{formatPrice(i.price_type_snapshot, i.price_cents_snapshot)}</span>
                  </li>
                ))}
              </ul>
              <h3 className="mt-5 text-sm font-semibold text-muted">Customer notes</h3>
              <p className="mt-1 whitespace-pre-wrap text-[15px]">{booking.customer_notes || <span className="text-muted">None</span>}</p>
            </section>

            {/* Check-in link */}
            <section className="rounded-[20px] border border-line bg-white p-5 shadow-soft sm:p-6">
              <h2 className="text-lg font-bold">Kiosk check-in</h2>
              {booking.checkin_id ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <button type="button" onClick={() => openCheckin(booking.checkin_id)} className="inline-flex items-center gap-2 font-semibold text-primary hover:underline">
                    <Link2 className="h-4 w-4" aria-hidden="true" />
                    {linked ? `${linked.reference_no} · ${linked.first_name} ${linked.last_name} · ${linked.rego}` : "Open linked check-in"}
                  </button>
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => run("unlink", () => linkCheckin(booking.id, null), "Check-in unlinked")}>
                    <Unlink /> Unlink
                  </Button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[15px] text-muted">Not linked to a check-in.</p>
                  {(booking.status === "booked" || booking.status === "arrived" || booking.status === "completed") && (
                    <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => setDialog("link")}>
                      <Link2 /> Link check-in
                    </Button>
                  )}
                </div>
              )}
            </section>

            <OwnerNotes key={booking.id} booking={booking} />

            {/* SMS */}
            <section className="rounded-[20px] border border-line bg-white p-5 shadow-soft sm:p-6">
              <h2 className="text-lg font-bold">Text messages</h2>
              {sms.length === 0 ? (
                <p className="mt-3 text-[15px] text-muted">No texts for this booking.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {sms.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{SMS_TEMPLATE_LABEL[s.template]}</p>
                        <p className="text-sm text-muted">
                          <span className={cn("font-semibold", s.status === "failed" && "text-red-700", s.status === "sent" && "text-emerald-700")}>
                            {SMS_STATUS_LABEL[s.status]}
                          </span>
                          {" · "}
                          {formatDateTime(s.sent_at ?? s.created_at)}
                          {s.last_error && s.status !== "sent" && ` · ${s.last_error}`}
                        </p>
                      </div>
                      {s.status === "failed" && (
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run(`sms-${s.id}`, () => retrySms(s.id), "SMS queued again")}>
                          {busy === `sms-${s.id}` ? <Loader2 className="animate-spin" /> : <RefreshCw />} Retry
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* History */}
            <section className="rounded-[20px] border border-line bg-white p-5 shadow-soft sm:p-6">
              <h2 className="text-lg font-bold">History</h2>
              <ol className="mt-3 space-y-2 text-[15px]">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-wrap justify-between gap-x-3">
                    <span>{eventLabel(e)}</span>
                    <time className="text-sm text-muted" dateTime={e.at}>{formatDateTime(e.at)}</time>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </main>

      {booking && (
        <>
          <CancelDialog open={dialog === "cancel"} onOpenChange={(o) => !o && setDialog(null)} booking={booking} onDone={load} />
          <RescheduleDialog open={dialog === "reschedule"} onOpenChange={(o) => !o && setDialog(null)} booking={booking} onDone={load} />
          <LinkCheckinDialog open={dialog === "link"} onOpenChange={(o) => !o && setDialog(null)} booking={booking} checkins={checkins} onDone={load} />
        </>
      )}
    </div>
  );
}

function OwnerNotes({ booking }: { booking: Booking }) {
  const [notes, setNotes] = useState(booking.owner_notes);
  const [saving, setSaving] = useState(false);
  const dirty = notes !== booking.owner_notes;
  return (
    <section className="rounded-[20px] border border-line bg-white p-5 shadow-soft sm:p-6">
      <label htmlFor="owner-notes" className="text-lg font-bold">
        Your notes
      </label>
      <p className="text-sm text-muted">Only you see these.</p>
      <Textarea id="owner-notes" className="mt-3" value={notes} maxLength={MAX_OWNER_NOTES} onChange={(e) => setNotes(e.target.value)} />
      <div className="mt-3 flex justify-end">
        <Button
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await saveOwnerNotes(booking.id, notes);
              toast.success("Notes saved");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Couldn't save the notes");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving && <Loader2 className="animate-spin" />} Save notes
        </Button>
      </div>
    </section>
  );
}

const ACTOR: Record<BookingEvent["actor"], string> = { customer: "Customer", owner: "You", system: "System" };

function eventLabel(e: BookingEvent): string {
  const d = e.details;
  const who = ACTOR[e.actor];
  switch (e.action) {
    case "created":
      return d.source === "online" ? "Booked online" : "Booked by you";
    case "cancelled":
      return `${who} cancelled${e.actor === "customer" ? " from their link" : d.notify ? " (customer texted)" : ""}`;
    case "rescheduled":
      return `${who} moved it from ${formatDay(String(d.from))} to ${formatDay(String(d.to))}${
        e.actor === "customer" ? " from their link" : d.notify ? " (customer texted)" : ""}`;
    case "arrived":
      return d.via === "checkin" ? "Arrived (check-in linked)" : `${who} marked arrived`;
    case "completed":
      return `${who} marked completed`;
    case "no_show":
      return `${who} marked no-show`;
    case "reverted":
      return `${who} undid: back to ${String(d.to).replace("_", "-")}`;
    case "overbooked":
      return "Booked over the day's capacity";
    case "linked_checkin":
      return d.checkin_id ? "Check-in linked" : "Check-in unlinked";
    case "sms_retry":
      return d.error ? "A text couldn't be queued" : "You retried a text";
    default:
      return e.action;
  }
}

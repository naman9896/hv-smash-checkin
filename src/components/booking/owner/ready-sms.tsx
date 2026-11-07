"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck, Loader2, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { BookingStatusPill } from "@/components/booking/owner/bits";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { formatDay } from "@/lib/booking/format";
import { BookingActionError, bookingForCheckin, sendCheckinReadySms } from "@/lib/booking/owner-data";
import { normaliseMobile } from "@/lib/booking/schemas";
import type { Checkin } from "@/lib/types";

/**
 * "Send ready SMS" (BUSINESS_RULES §10). Tries once; if a ready text already went out for this car,
 * asks "Send again?" and resends only on yes.
 */
export function ReadySmsButton({
  send,
  disabledReason,
  onSent,
  className,
}: {
  send: (resend: boolean) => Promise<void>;
  disabledReason?: string | null;
  onSent?: () => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function go(resend: boolean) {
    setBusy(true);
    try {
      await send(resend);
      toast.success("Ready text queued");
      setConfirm(false);
      onSent?.();
    } catch (e) {
      if (!resend && e instanceof BookingActionError && e.detail === "already_sent") setConfirm(true);
      else toast.error(e instanceof Error ? e.message : "Couldn't send the text");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <Button variant="success" disabled={busy || !!disabledReason} onClick={() => go(false)}>
        {busy && !confirm ? <Loader2 className="animate-spin" /> : <MessageSquareText />} Send ready SMS
      </Button>
      {disabledReason && <p className="mt-1.5 text-sm font-medium text-muted">{disabledReason}</p>}
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Send again?"
        description="A ready text has already been sent for this car."
        icon={<MessageSquareText className="text-emerald-600" />}
      >
        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <Button variant="success" className="sm:flex-1" disabled={busy} onClick={() => go(true)}>
            {busy && <Loader2 className="animate-spin" />} Send again
          </Button>
          <Button variant="outline" className="sm:flex-1" disabled={busy} onClick={() => setConfirm(false)}>
            Don&apos;t send
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/** On the check-in drawer: the linked booking (if any) and the ready SMS button, walk-ins included. */
export function CheckinBooking({ c }: { c: Checkin }) {
  const [booking, setBooking] = useState<Awaited<ReturnType<typeof bookingForCheckin>> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    bookingForCheckin(c.id)
      .then((b) => !cancelled && setBooking(b))
      .catch(() => !cancelled && setBooking(null));
    return () => {
      cancelled = true;
    };
  }, [c.id, c.status]);

  const reason =
    c.status === "cancelled" ? "This check-in is cancelled." : !booking && !normaliseMobile(c.phone) ? "Not a mobile number" : null;

  return (
    <section className="rounded-[20px] border border-line bg-white p-5">
      <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Booking &amp; pickup text</h2>
      {booking === undefined ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Checking…</p>
      ) : booking ? (
        <Link
          href={`/dashboard/bookings/${booking.id}`}
          className="mt-3 flex flex-wrap items-center gap-2 rounded-[12px] bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-100"
        >
          <CalendarCheck className="h-4 w-4" aria-hidden="true" />
          Booked {booking.source === "online" ? "online" : "by you"} for {formatDay(booking.drop_off_date)}
          <span className="font-mono">{booking.reference_no}</span>
          <BookingStatusPill status={booking.status} />
        </Link>
      ) : (
        <p className="mt-3 text-sm text-muted">Walk-in: no booking.</p>
      )}
      <ReadySmsButton
        className="mt-4"
        send={(resend) => sendCheckinReadySms(c.id, resend)}
        disabledReason={booking === undefined ? null : reason}
      />
    </section>
  );
}

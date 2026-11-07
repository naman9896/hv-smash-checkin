// Owner dashboard rules for bookings (BUSINESS_RULES §7–8, §10). Pure: unit-tested, used by the
// Bookings tab. The database enforces the same rules (booking_owner_* functions); this only
// decides which buttons to show and how to word errors.
import { formatDay } from "./format";

export type BookingStatus = "booked" | "arrived" | "completed" | "cancelled" | "no_show";

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  booked: "Booked",
  arrived: "Arrived",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export type StatusAction = { to: BookingStatus; label: string; undo: boolean };

/** Status buttons for a booking. Cancel and reschedule have their own dialogs. */
export function statusActions(status: BookingStatus, dropOffDate: string, today: string): StatusAction[] {
  switch (status) {
    case "booked":
      return [
        { to: "arrived", label: "Mark arrived", undo: false },
        ...(dropOffDate <= today ? [{ to: "no_show" as const, label: "Mark no-show", undo: false }] : []),
      ];
    case "arrived":
      return [
        { to: "completed", label: "Mark completed", undo: false },
        { to: "booked", label: "Undo arrived", undo: true },
      ];
    case "completed":
      return [{ to: "arrived", label: "Undo completed", undo: true }];
    case "no_show":
      return [{ to: "booked", label: "Undo no-show", undo: true }];
    case "cancelled":
      return [{ to: "booked", label: "Re-open booking", undo: true }];
  }
}

export const NOT_ARRIVED_AFTER = "17:00";

/** "Not arrived": still booked after 17:00 on its day, or on an earlier day (BUSINESS_RULES §8). */
export function isNotArrived(b: { status: BookingStatus; drop_off_date: string }, now: { date: string; time: string }): boolean {
  if (b.status !== "booked") return false;
  return b.drop_off_date < now.date || (b.drop_off_date === now.date && now.time >= NOT_ARRIVED_AFTER);
}

/** Today's date and time (HH:MM) in Sydney. */
export function sydneyNow(now: Date = new Date()): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export type SmsStatus = "pending" | "sending" | "sent" | "failed" | "cancelled";
export type SmsTemplate = "confirmation" | "reminder" | "ready" | "cancelled" | "rescheduled" | "booking_link";

export const SMS_TEMPLATE_LABEL: Record<SmsTemplate, string> = {
  confirmation: "Confirmation",
  reminder: "Reminder",
  ready: "Ready for pickup",
  cancelled: "Cancellation",
  rescheduled: "New date",
  booking_link: "Booking link",
};

export const SMS_STATUS_LABEL: Record<SmsStatus, string> = {
  pending: "Queued",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Not sent",
};

export type SmsSummary = "failed" | "queued" | "sent" | "none";

/** One badge per booking: any failed SMS wins (it needs the owner), then queued, then sent. */
export function smsSummary(rows: { status: SmsStatus }[]): SmsSummary {
  if (rows.some((r) => r.status === "failed")) return "failed";
  if (rows.some((r) => r.status === "pending" || r.status === "sending")) return "queued";
  if (rows.some((r) => r.status === "sent")) return "sent";
  return "none";
}

/** Owner-facing wording for errors raised by the booking_owner_* functions. */
export function ownerErrorMessage(err: { code?: string; message?: string; details?: string | null }): string {
  const code = err.code === "P0001" ? err.message : undefined;
  const d = err.details ?? "";
  switch (code) {
    case "FULL":
      return "That day is full. Tick “Overbook” to book it anyway.";
    case "CLOSED":
      return d === "past" ? "That day has already passed." : "The workshop is closed that day.";
    case "DUPLICATE_BOOKING":
      return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `This car already has a booking on ${formatDay(d)}.` : "This car already has a booking that day.";
    case "INVALID_TRANSITION":
      if (d === "not_yet") return "You can mark a no-show on or after the drop-off day.";
      if (d === "already_sent") return "A ready text has already been sent for this car.";
      if (d === "cancelled>ready") return "This check-in is cancelled.";
      return "This booking has changed. Refresh and try again.";
    case "NOT_FOUND":
      return d === "checkin" ? "That check-in no longer exists." : "This booking no longer exists.";
    case "VALIDATION":
      if (d === "checkin_id") return "That check-in is already linked to another booking.";
      if (d === "mobile") return "Enter an Australian mobile, e.g. 0412 345 678.";
      if (d === "sms_off") return "Texts are turned off in booking settings.";
      if (d === "not_mobile") return "Not a mobile number.";
      return "Please check the details and try again.";
    case "RATE_LIMITED":
      return "This mobile has already had 5 booking links today.";
    default:
      return "Something went wrong. Please try again.";
  }
}

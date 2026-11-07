"use client";

// Owner dashboard data for bookings (API_SPEC §2). The browser client runs as the signed-in owner:
// reads go through RLS, changes only through the booking_owner_* functions (the owner can update
// nothing on bookings except owner_notes and is_read).
import { getSupabase } from "@/lib/supabase";
import { ownerErrorMessage, type BookingStatus, type SmsStatus, type SmsTemplate } from "./owner";

export type BookingItem = { service_id: string; name_snapshot: string; price_type_snapshot: "fixed" | "from" | "quote"; price_cents_snapshot: number | null };

export type Booking = {
  id: string;
  reference_no: string;
  status: BookingStatus;
  source: "online" | "owner";
  drop_off_date: string;
  window_id: string | null;
  window_start: string;
  window_end: string;
  first_name: string;
  last_name: string;
  mobile: string;
  email: string | null;
  rego: string;
  rego_state: string;
  make: string;
  model: string;
  year: number | null;
  customer_notes: string;
  owner_notes: string;
  over_capacity: boolean;
  checkin_id: string | null;
  cancelled_at: string | null;
  is_read: boolean;
  created_at: string;
  updated_at: string;
  booking_items: BookingItem[];
};

export type BookingSms = {
  id: string;
  booking_id: string | null;
  template: SmsTemplate;
  status: SmsStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

export type BookingEvent = { id: string; at: string; actor: "customer" | "owner" | "system"; action: string; details: Record<string, unknown> };

export type DayAvailability = {
  day: string;
  status: "open" | "full" | "closed";
  reason: string | null;
  note: string | null;
  capacity: number;
  booked: number;
  spots_left: number;
};

export type UnreadBooking = Pick<Booking, "id" | "reference_no" | "first_name" | "last_name" | "rego" | "drop_off_date" | "source" | "created_at">;

const COLUMNS =
  "id, reference_no, status, source, drop_off_date, window_id, window_start, window_end, first_name, last_name, mobile, email, rego, " +
  "rego_state, make, model, year, customer_notes, owner_notes, over_capacity, checkin_id, cancelled_at, is_read, created_at, " +
  "updated_at, booking_items(service_id, name_snapshot, price_type_snapshot, price_cents_snapshot)";
const SMS_COLUMNS = "id, booking_id, template, status, attempts, last_error, created_at, sent_at";
const UNREAD_COLUMNS = "id, reference_no, first_name, last_name, rego, drop_off_date, source, created_at";

/** An error from a booking function, already worded for the owner. `detail` is the DB detail (e.g. already_sent). */
export class BookingActionError extends Error {
  constructor(message: string, readonly detail: string | null = null) {
    super(message);
  }
}

function fail(error: { code?: string; message: string; details?: string | null } | null): asserts error is null {
  if (error) throw new BookingActionError(ownerErrorMessage(error), error.details ?? null);
}

export async function listBookingsOn(date: string): Promise<Booking[]> {
  const { data, error } = await getSupabase()
    .from("bookings").select(COLUMNS).eq("drop_off_date", date).order("window_start").order("created_at");
  fail(error);
  return (data ?? []) as unknown as Booking[];
}

export async function getBooking(id: string): Promise<Booking | null> {
  const { data, error } = await getSupabase().from("bookings").select(COLUMNS).eq("id", id).maybeSingle();
  fail(error);
  return data as unknown as Booking | null;
}

export async function listUnreadBookings(): Promise<UnreadBooking[]> {
  const { data, error } = await getSupabase()
    .from("bookings").select(UNREAD_COLUMNS).eq("is_read", false).order("created_at", { ascending: false }).limit(200);
  fail(error);
  return (data ?? []) as UnreadBooking[];
}

export async function listSmsFor(bookingIds: string[]): Promise<BookingSms[]> {
  if (!bookingIds.length) return [];
  const { data, error } = await getSupabase()
    .from("sms_outbox").select(SMS_COLUMNS).in("booking_id", bookingIds).order("created_at");
  fail(error);
  return (data ?? []) as BookingSms[];
}

export async function listEvents(bookingId: string): Promise<BookingEvent[]> {
  const { data, error } = await getSupabase()
    .from("booking_events").select("id, at, actor, action, details").eq("booking_id", bookingId).order("at");
  fail(error);
  return (data ?? []) as BookingEvent[];
}

/** Earlier no-shows for this mobile (BUSINESS_RULES §9: staff see the count). */
export async function noShowCount(mobile: string, exceptId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from("bookings").select("id", { count: "exact", head: true }).eq("mobile", mobile).eq("status", "no_show").neq("id", exceptId);
  fail(error);
  return count ?? 0;
}

export async function dayAvailability(date: string): Promise<DayAvailability | null> {
  const { data, error } = await getSupabase().rpc("booking_availability", { p_from: date, p_to: date, p_online: false });
  fail(error);
  return ((data ?? []) as DayAvailability[])[0] ?? null;
}

export async function listWindows(): Promise<{ id: string; start_time: string; end_time: string }[]> {
  const { data, error } = await getSupabase()
    .from("booking_windows").select("id, start_time, end_time").eq("active", true).order("sort_order");
  fail(error);
  return data ?? [];
}

export async function saveOwnerNotes(id: string, owner_notes: string): Promise<void> {
  const { error } = await getSupabase().from("bookings").update({ owner_notes }).eq("id", id);
  fail(error);
}

export async function markBookingsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await getSupabase().from("bookings").update({ is_read: true }).in("id", ids);
  fail(error);
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await getSupabase().rpc(fn, args);
  fail(error);
}

export type CustomerLookup = {
  firstName: string;
  lastName: string;
  email: string | null;
  vehicles: { rego: string; state: string | null; make: string; model: string; year: number | null }[];
  noShows: number;
};

/** Pre-fill for quick add: earlier bookings and kiosk check-ins with this mobile (null = new customer). */
export async function customerLookup(mobile: string): Promise<CustomerLookup | null> {
  const { data, error } = await getSupabase().rpc("booking_customer_lookup", { p_mobile: mobile });
  fail(error);
  return (data ?? null) as CustomerLookup | null;
}

/** Active services, online-bookable or not (the owner can book any of them). */
export async function listActiveServices(): Promise<
  { id: string; name: string; price_type: "fixed" | "from" | "quote"; price_cents: number | null }[]
> {
  const { data, error } = await getSupabase()
    .from("booking_services").select("id, name, price_type, price_cents").eq("active", true).order("sort_order").order("name");
  fail(error);
  return data ?? [];
}

export async function availabilityRange(from: string, to: string): Promise<DayAvailability[]> {
  const { data, error } = await getSupabase().rpc("booking_availability", { p_from: from, p_to: to, p_online: false });
  fail(error);
  return (data ?? []) as DayAvailability[];
}

/** Quick add. Input is the snake_case booking_create JSON (see schemas.ts toDbInput). */
export async function ownerCreateBooking(p: Record<string, unknown>, allowOver: boolean, sendSms: boolean): Promise<{ id: string; reference_no: string }> {
  const { data, error } = await getSupabase().rpc("booking_owner_create", { p, p_allow_over: allowOver, p_send_sms: sendSms });
  fail(error);
  return data as { id: string; reference_no: string };
}

export const sendBookingLink = (mobile: string) => rpc("booking_send_link", { p_mobile: mobile });

/** Ready-for-pickup SMS from a booking or a check-in (walk-ins too). Throws detail already_sent unless resend. */
export const sendReadySms = (bookingId: string, resend: boolean) => rpc("booking_send_ready_sms", { p_id: bookingId, p_resend: resend });
export const sendCheckinReadySms = (checkinId: string, resend: boolean) =>
  rpc("booking_checkin_ready_sms", { p_checkin_id: checkinId, p_resend: resend });

/** The booking linked to a check-in, if any (the link lives in bookings.checkin_id). */
export async function bookingForCheckin(checkinId: string): Promise<Pick<Booking, "id" | "reference_no" | "status" | "source" | "drop_off_date"> | null> {
  const { data, error } = await getSupabase()
    .from("bookings").select("id, reference_no, status, source, drop_off_date").eq("checkin_id", checkinId).maybeSingle();
  fail(error);
  return data as Pick<Booking, "id" | "reference_no" | "status" | "source" | "drop_off_date"> | null;
}

export const setBookingStatus = (id: string, status: BookingStatus) => rpc("booking_owner_set_status", { p_id: id, p_status: status });
export const cancelBooking = (id: string, notify: boolean) => rpc("booking_owner_cancel", { p_id: id, p_notify: notify });
export const rescheduleBooking = (id: string, date: string, windowId: string, allowOver: boolean, notify: boolean) =>
  rpc("booking_owner_reschedule", { p_id: id, p_date: date, p_window_id: windowId, p_allow_over: allowOver, p_notify: notify });
export const linkCheckin = (id: string, checkinId: string | null) => rpc("booking_link_checkin", { p_id: id, p_checkin_id: checkinId });
export const retrySms = (outboxId: string) => rpc("booking_retry_sms", { p_outbox_id: outboxId });

type Change<T> = { onInsert?: (row: T) => void; onUpdate?: (row: T) => void; onDelete?: (id: string) => void };

/** Live booking changes (rows come without booking_items: merge or refetch). */
export function subscribeBookings(l: Change<Omit<Booking, "booking_items">>): () => void {
  const sb = getSupabase();
  const channel = sb
    .channel(`bookings-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "bookings" }, (p) => l.onInsert?.(p.new as Booking))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bookings" }, (p) => l.onUpdate?.(p.new as Booking))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "bookings" }, (p) => l.onDelete?.((p.old as { id: string }).id))
    .subscribe();
  return () => {
    sb.removeChannel(channel);
  };
}

/** Live SMS status changes (for the SMS badges). */
export function subscribeSms(cb: (row: BookingSms) => void): () => void {
  const sb = getSupabase();
  const channel = sb
    .channel(`sms-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "sms_outbox" }, (p) => p.new && "id" in p.new && cb(p.new as BookingSms))
    .subscribe();
  return () => {
    sb.removeChannel(channel);
  };
}

/** Earlier no-shows per mobile (for the day list). The owner reads bookings through RLS. */
export async function noShowCounts(mobiles: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!mobiles.length) return out;
  const { data, error } = await getSupabase().from("bookings").select("mobile").eq("status", "no_show").in("mobile", [...new Set(mobiles)]);
  if (error) return out; // a missing count never blocks the day view
  for (const r of data as { mobile: string }[]) out.set(r.mobile, (out.get(r.mobile) ?? 0) + 1);
  return out;
}

"use client";

// Settings → Online Booking data (API_SPEC §2 "Booking settings"). The browser client runs as
// the owner: RLS + column grants allow exactly these edits; the DB checks every value again.
import { getSupabase } from "@/lib/supabase";

export type BookingSettingsRow = {
  online_enabled: boolean; horizon_days: number; online_cutoff_time: string; cancel_cutoff_time: string; reminder_time: string;
  pickup_message: string; price_disclaimer: string; sms_sender_id: string; sms_enabled: boolean;
  ready_sms_mode: "manual" | "on_complete"; max_active_per_mobile: number;
};
export type ServiceRow = {
  id: string; name: string; description: string; price_type: "fixed" | "from" | "quote"; price_cents: number | null;
  online_bookable: boolean; active: boolean; sort_order: number;
};
export type WeeklyRow = { weekday: number; is_open: boolean; open_time: string; close_time: string; capacity_cars: number };
export type WindowRow = { id: string; start_time: string; end_time: string; sort_order: number; active: boolean };
export type OverrideDbRow = {
  date: string; is_open: boolean; open_time: string | null; close_time: string | null; capacity_cars: number | null;
  reason: string | null; show_phone: boolean;
};
export type DayBooking = { id: string; reference_no: string; first_name: string; last_name: string; rego: string; status: string; window_start: string };

const SETTINGS_COLUMNS =
  "online_enabled, horizon_days, online_cutoff_time, cancel_cutoff_time, reminder_time, pickup_message, price_disclaimer, sms_sender_id, sms_enabled, ready_sms_mode, max_active_per_mobile";

/** DB errors → a sentence for the owner (check constraint names never shown). */
function fail(error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (error.code === "23514") throw new Error("That value isn't allowed. Please check the highlighted fields.");
  if (error.code === "23505") throw new Error("That already exists.");
  if (error.code === "42501") throw new Error("You don't have permission to change that.");
  throw new Error("Couldn't save. Please try again.");
}

export async function loadBookingSettings() {
  const sb = getSupabase();
  const [s, sv, h, w, o] = await Promise.all([
    sb.from("booking_settings").select(SETTINGS_COLUMNS).eq("id", 1).single(),
    sb.from("booking_services").select("id, name, description, price_type, price_cents, online_bookable, active, sort_order").order("sort_order").order("name"),
    sb.from("booking_weekly_hours").select("weekday, is_open, open_time, close_time, capacity_cars").order("weekday"),
    sb.from("booking_windows").select("id, start_time, end_time, sort_order, active").order("sort_order").order("start_time"),
    sb.from("booking_date_overrides").select("date, is_open, open_time, close_time, capacity_cars, reason, show_phone").order("date"),
  ]);
  for (const r of [s, sv, h, w, o]) if (r.error) throw new Error("Couldn't load the booking settings.");
  return {
    settings: s.data as BookingSettingsRow,
    services: sv.data as ServiceRow[],
    hours: h.data as WeeklyRow[],
    windows: w.data as WindowRow[],
    overrides: o.data as OverrideDbRow[],
  };
}

export async function saveBookingSettings(patch: Partial<BookingSettingsRow>): Promise<BookingSettingsRow> {
  const { data, error } = await getSupabase().from("booking_settings").update(patch).eq("id", 1).select(SETTINGS_COLUMNS).single();
  fail(error);
  return data as BookingSettingsRow;
}

export async function saveWeeklyHours(rows: WeeklyRow[]): Promise<void> {
  const sb = getSupabase();
  for (const { weekday, ...r } of rows) fail((await sb.from("booking_weekly_hours").update(r).eq("weekday", weekday)).error);
}

export async function saveService(s: Omit<ServiceRow, "id"> & { id?: string }): Promise<void> {
  const sb = getSupabase();
  const { id, ...row } = s;
  fail((id ? await sb.from("booking_services").update(row).eq("id", id) : await sb.from("booking_services").insert(row)).error);
}

export async function saveWindow(w: Omit<WindowRow, "id"> & { id?: string }): Promise<void> {
  const sb = getSupabase();
  const { id, ...row } = w;
  fail((id ? await sb.from("booking_windows").update(row).eq("id", id) : await sb.from("booking_windows").insert(row)).error);
}

export async function deleteWindow(id: string): Promise<void> {
  fail((await getSupabase().from("booking_windows").delete().eq("id", id)).error);
}

export async function saveOverride(o: OverrideDbRow): Promise<void> {
  fail((await getSupabase().from("booking_date_overrides").upsert(o)).error);
}

export async function deleteOverride(date: string): Promise<void> {
  fail((await getSupabase().from("booking_date_overrides").delete().eq("date", date)).error);
}

/** Active bookings on a day (shown before the owner closes it). */
export async function bookingsOnDate(date: string): Promise<DayBooking[]> {
  const { data, error } = await getSupabase().rpc("booking_on_date", { p_date: date });
  if (error) throw new Error("Couldn't check the bookings for that day.");
  return data as DayBooking[];
}


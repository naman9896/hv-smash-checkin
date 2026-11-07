// Shared helpers for booking DB tests (staging only; the env guard runs first).
// Rules: only create rows with this run's unique regos / random far-future dates,
// and clean up only the rows this run created.

import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireTestTarget } from "../support/env-guard";

export const target = requireTestTarget();

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

export const serviceClient = (): SupabaseClient => createClient(target.url, target.serviceRoleKey, noSession);
export const anonClient = (): SupabaseClient => createClient(target.url, target.anonKey, noSession);

export async function ownerClient(): Promise<SupabaseClient> {
  const email = process.env.TEST_OWNER_EMAIL;
  const password = process.env.TEST_OWNER_PASSWORD;
  if (!email || !password) throw new Error("TEST_OWNER_EMAIL / TEST_OWNER_PASSWORD missing from .env.test.local");
  const c = createClient(target.url, target.anonKey, noSession);
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Test owner sign-in failed (${error.status ?? "?"})`); // no credentials in the message
  return c;
}

// ---------- dates ----------
const DAY = 86_400_000;

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** ISO weekday 1 = Mon … 7 = Sun. */
export function isoWeekday(date: string): number {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

/** A random Monday in 2031–2044: no seeded holidays, and unlikely to clash with another run. */
export function randomFarMonday(): string {
  let d = "2031-01-01";
  while (isoWeekday(d) !== 1) d = addDays(d, 1);
  return addDays(d, 7 * Math.floor(Math.random() * 700));
}

/** UTC instant (ISO) of a wall-clock time in Australia/Sydney. Not for the 2–3am DST gap. */
export function sydney(date: string, hhmm: string): string {
  const wanted = Date.parse(`${date}T${hhmm}:00Z`); // the wall-clock time, read as if UTC
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  let guess = wanted - 10 * 3_600_000;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(fmt.formatToParts(guess).map((x) => [x.type, x.value]));
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    guess += wanted - shown;
  }
  return new Date(guess).toISOString();
}

// ---------- test rows ----------
export const RUN = randomBytes(3).toString("hex").toUpperCase().slice(0, 5); // e.g. "A1B2C"
let seq = 0;
/** Unique rego for this run: "T" + run id + counter (≤ 9 chars, A–Z0–9). */
export const testRego = () => `T${RUN}${String(seq++).padStart(3, "0")}`;
export const testMobile = () => `+6149${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

export type Availability = {
  day: string;
  status: "open" | "full" | "closed";
  reason: string | null;
  note: string | null;
  capacity: number;
  booked: number;
  spots_left: number;
  call_us: boolean;
};

export async function availabilityAt(
  db: SupabaseClient,
  from: string,
  to: string,
  online: boolean,
  now: string,
): Promise<Availability[]> {
  const { data, error } = await db.rpc("booking_availability_at", { p_from: from, p_to: to, p_online: online, p_now: now });
  if (error) throw new Error(`booking_availability_at: ${error.code} ${error.message}`);
  return data as Availability[];
}

export async function dayAt(db: SupabaseClient, date: string, online: boolean, now: string): Promise<Availability> {
  const rows = await availabilityAt(db, date, date, online, now);
  if (rows.length !== 1) throw new Error(`expected 1 row for ${date}, got ${rows.length}`);
  return rows[0];
}

/** Tracks and removes the rows a test file created. */
export class Created {
  bookings: string[] = [];
  overrides: string[] = [];
  holidays: string[] = [];
  outbox: string[] = [];
  /** booking id → raw manage token (for /b/{token} tests) */
  tokens = new Map<string, string>();

  constructor(private db: SupabaseClient) {}

  async booking(date: string, status = "booked", extra: Record<string, unknown> = {}): Promise<string> {
    const { data: win, error: wErr } = await this.db
      .from("booking_windows").select("id, start_time, end_time").eq("active", true).order("sort_order").limit(1).single();
    if (wErr) throw new Error(`window: ${wErr.message}`);
    const token = randomBytes(32).toString("base64url"); // 43 chars, like booking_create's
    const { data, error } = await this.db
      .from("bookings")
      .insert({
        status,
        source: "online",
        drop_off_date: date,
        window_id: win.id,
        window_start: win.start_time,
        window_end: win.end_time,
        first_name: "Test",
        last_name: "Booking",
        mobile: testMobile(),
        rego: testRego(),
        rego_state: "NSW",
        make: "Toyota",
        model: "Corolla",
        manage_token_hash: `\\x${createHash("sha256").update(token).digest("hex")}`,
        cancelled_at: status === "cancelled" ? new Date().toISOString() : null,
        ...extra,
      })
      .select("id")
      .single();
    if (error) throw new Error(`insert booking: ${error.code} ${error.message}`);
    this.bookings.push(data.id);
    this.tokens.set(data.id, token);
    const { error: tErr } = await this.db.from("booking_tokens").insert({ booking_id: data.id, token, expires_on: addDays(date, 7) });
    if (tErr) throw new Error(`insert token: ${tErr.code} ${tErr.message}`);
    return data.id;
  }

  /** The raw manage token of a booking made with booking(). */
  tokenOf(id: string): string {
    const t = this.tokens.get(id);
    if (!t) throw new Error("no token for that booking");
    return t;
  }

  async override(row: { date: string; is_open: boolean; capacity_cars?: number | null; reason?: string; show_phone?: boolean }) {
    const { error } = await this.db.from("booking_date_overrides").upsert(row);
    if (error) throw new Error(`override: ${error.code} ${error.message}`);
    this.overrides.push(row.date);
  }

  async holiday(date: string, name: string) {
    const { error } = await this.db.from("booking_public_holidays").upsert({ date, name });
    if (error) throw new Error(`holiday: ${error.code} ${error.message}`);
    this.holidays.push(date);
  }

  /** Track a booking made some other way (e.g. booking_create) so cleanup removes it. */
  track(id: string) {
    this.bookings.push(id);
  }

  /** Insert an sms_outbox row directly (tests only). */
  async sms(row: Record<string, unknown>): Promise<string> {
    const { data, error } = await this.db
      .from("sms_outbox")
      .insert({ template: "confirmation", to_mobile: testMobile(), body: "Test {manage_link}", dedupe_key: `test:${crypto.randomUUID()}`, ...row })
      .select("id")
      .single();
    if (error) throw new Error(`insert sms: ${error.code} ${error.message}`);
    this.outbox.push(data.id);
    return data.id;
  }

  async cleanup() {
    if (this.outbox.length) await this.db.from("sms_outbox").delete().in("id", this.outbox);
    this.outbox = [];
    if (this.bookings.length) {
      // sms_outbox rows only get booking_id set null on delete: remove them first
      await this.db.from("sms_outbox").delete().in("booking_id", this.bookings);
      await this.db.from("bookings").delete().in("id", this.bookings);
    }
    if (this.overrides.length) await this.db.from("booking_date_overrides").delete().in("date", this.overrides);
    if (this.holidays.length) await this.db.from("booking_public_holidays").delete().in("date", this.holidays);
    this.bookings = [];
    this.overrides = [];
    this.holidays = [];
  }
}

// ---------- booking_create ----------
export type CreateInput = {
  service_ids: string[];
  date: string;
  window_id: string;
  first_name: string;
  last_name: string;
  mobile: string;
  email?: string | null;
  rego: string;
  rego_state: string;
  make: string;
  model: string;
  year?: number | null;
  notes?: string;
  [extra: string]: unknown;
};

export type CreateResult = { id: string; reference_no: string; token: string; date: string; window_start: string; window_end: string };

export async function bookingIds(db: SupabaseClient) {
  const { data: services } = await db.from("booking_services").select("id, name, active, online_bookable").order("sort_order");
  const { data: windows } = await db.from("booking_windows").select("id").eq("active", true).order("sort_order");
  return { services: services!, windowId: windows![0].id as string };
}

export function validInput(base: { serviceId: string; windowId: string; date: string }, over: Partial<CreateInput> = {}): CreateInput {
  return {
    service_ids: [base.serviceId],
    date: base.date,
    window_id: base.windowId,
    first_name: "Test",
    last_name: "Booking",
    mobile: testMobile(),
    rego: testRego(),
    rego_state: "NSW",
    make: "Toyota",
    model: "Corolla",
    ...over,
  };
}

/** Calls booking_create; returns data or the error code (the exception message). */
export async function create(
  db: SupabaseClient,
  input: CreateInput,
  source: "online" | "owner" = "online",
  allowOver = false,
): Promise<{ ok: true; data: CreateResult } | { ok: false; code: string; details: string | null; sqlstate: string }> {
  const { data, error } = await db.rpc("booking_create", { p: input, p_source: source, p_allow_over: allowOver });
  if (error) return { ok: false, code: error.message, details: error.details ?? null, sqlstate: error.code };
  return { ok: true, data: data as CreateResult };
}

/** First date from today+2 … today+30 (real clock) that is open online with ≥ minSpots left. */
export async function openOnlineDate(db: SupabaseClient, minSpots = 2): Promise<string> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
  const { data, error } = await db.rpc("booking_availability", { p_from: addDays(today, 2), p_to: addDays(today, 30), p_online: true });
  if (error) throw new Error(`availability: ${error.message}`);
  const day = (data as Availability[]).find((d) => d.status === "open" && d.spots_left >= minSpots);
  if (!day) throw new Error("no open online day in the next 30 days on staging");
  return day.day;
}

export function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
}

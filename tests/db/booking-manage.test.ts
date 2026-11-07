// T7: the customer's manage link (/b/{token}) — view, cancel, reschedule (BUSINESS_RULES §9,
// API_SPEC §1, SECURITY "Manage page shows too much"). The route handlers call these as the
// service role, so the tests do too. Reschedule targets are near-future days opened with
// overrides (online rules: from tomorrow, up to the horizon).
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { addDays, Created, serviceClient, sydneyToday, testRego } from "./booking-helpers";

const db = serviceClient();
const created = new Created(db);
afterEach(() => created.cleanup());

type Result = { ok: true; data: Record<string, unknown> } | { ok: false; code: string; details: string | null };
async function call(fn: string, args: Record<string, unknown>): Promise<Result> {
  const { data, error } = await db.rpc(fn, args);
  return error ? { ok: false, code: error.message, details: error.details ?? null } : { ok: true, data };
}
function ok(r: Result): Record<string, unknown> {
  if (!r.ok) throw new Error(`expected success, got ${r.code} (${r.details})`);
  return r.data;
}
const view = (token: string) => call("booking_by_token", { p_token: token });
const cancel = (token: string) => call("booking_cancel_by_token", { p_token: token });
const reschedule = (token: string, date: string, windowId: string) =>
  call("booking_reschedule_by_token", { p_token: token, p_date: date, p_window_id: windowId });

const today = sydneyToday();
/** Sydney wall-clock time now, "HH:MM". */
const nowHHMM = () =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

async function windowId(): Promise<string> {
  const { data } = await db.from("booking_windows").select("id").eq("active", true).order("sort_order").limit(1).single();
  return data!.id;
}
async function row(id: string) {
  return (await db.from("bookings").select("status, drop_off_date, is_read, cancelled_at").eq("id", id).single()).data!;
}
async function lastEvent(id: string) {
  return (await db.from("booking_events").select("actor, action, details").eq("booking_id", id).order("at", { ascending: false }).limit(1).single()).data!;
}
async function sms(id: string) {
  return (await db.from("sms_outbox").select("template, body, status, dedupe_key").eq("booking_id", id).order("created_at")).data!;
}
/** A booked booking with a manage token, on an open day. */
async function bookingOn(date: string, extra: Record<string, unknown> = {}) {
  const id = await created.booking(date, "booked", { first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", customer_notes: "Secret note", ...extra });
  return { id, token: created.tokenOf(id) };
}
const open = (date: string, capacity = 50) => created.override({ date, is_open: true, capacity_cars: capacity });

describe("booking_by_token (view)", () => {
  it("shows only what the page needs: no surname, mobile, email or notes", async () => {
    const date = addDays(today, 20);
    const { id, token } = await bookingOn(date);
    const { data: svc } = await db.from("booking_services").select("id, name").eq("active", true).order("sort_order").limit(1).single();
    expect((await db.from("booking_items").insert({ booking_id: id, service_id: svc!.id, name_snapshot: "Logbook service", price_type_snapshot: "quote" })).error).toBeNull();

    const v = ok(await view(token));
    expect(Object.keys(v).sort()).toEqual([
      "can_change", "change_until", "date", "first_name", "make", "model", "phone", "reference_no", "rego", "services", "status",
      "window_end", "window_start",
    ]);
    expect(v).toMatchObject({ first_name: "Ada", date, status: "booked", can_change: true, services: ["Logbook service"], make: "Toyota", model: "Corolla" });
    expect(v.change_until).toBe(`${addDays(date, -1)}T17:00`);
    expect(v.window_start).toMatch(/^\d{2}:\d{2}$/);
    expect(JSON.stringify(v)).not.toMatch(/Lovelace|ada@example|Secret note|\+614/);
  });

  it("unknown, malformed or empty token → NOT_FOUND", async () => {
    for (const t of [randomBytes(32).toString("base64url"), "nope", "", "x".repeat(500)]) {
      expect(await view(t)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    }
  });

  it("works until drop-off + 7 days, then NOT_FOUND", async () => {
    const lastDay = await bookingOn(addDays(today, -7));
    expect(ok(await view(lastDay.token))).toMatchObject({ can_change: false });
    const expired = await bookingOn(addDays(today, -8));
    expect(await view(expired.token)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("can_change: only 'booked', and only until 17:00 the day before", async () => {
    expect(ok(await view((await bookingOn(today)).token)).can_change).toBe(false);
    expect(ok(await view((await bookingOn(addDays(today, 1))).token)).can_change).toBe(nowHHMM() < "17:00");
    expect(ok(await view((await bookingOn(addDays(today, 2))).token)).can_change).toBe(true);

    const arrived = await created.booking(addDays(today, 5), "arrived");
    expect(ok(await view(created.tokenOf(arrived)))).toMatchObject({ status: "arrived", can_change: false });
    const cancelled = await created.booking(addDays(today, 5), "cancelled");
    expect(ok(await view(created.tokenOf(cancelled)))).toMatchObject({ status: "cancelled", can_change: false });
  });
});

describe("booking_cancel_by_token", () => {
  it("cancels, records the customer, flags it unread for the owner and queues the SMS", async () => {
    const date = addDays(today, 20);
    const { id, token } = await bookingOn(date, { is_read: true });
    const v = ok(await cancel(token));
    expect(v).toMatchObject({ status: "cancelled", can_change: false, date });

    expect(await row(id)).toMatchObject({ status: "cancelled", is_read: false });
    expect(await lastEvent(id)).toEqual({ actor: "customer", action: "cancelled", details: { notify: true } });
    const texts = await sms(id);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ template: "cancelled", status: "pending", dedupe_key: `${id}:cancelled:1` });
    expect(texts[0].body).toContain("{booking_page}");
  });

  it("twice → INVALID_TRANSITION; after the cutoff → CUTOFF_PASSED; bad token → NOT_FOUND", async () => {
    const { token } = await bookingOn(addDays(today, 20));
    ok(await cancel(token));
    expect(await cancel(token)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });

    const late = await bookingOn(today);
    expect(await cancel(late.token)).toMatchObject({ ok: false, code: "CUTOFF_PASSED" });
    expect((await row(late.id)).status).toBe("booked");

    const arrived = await created.booking(addDays(today, 3), "arrived");
    expect(await cancel(created.tokenOf(arrived))).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(await cancel(randomBytes(32).toString("base64url"))).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("booking_reschedule_by_token", () => {
  it("moves the booking: same link, new expiry, old texts stopped, rescheduled SMS, unread for the owner", async () => {
    const [from, to] = [addDays(today, 10), addDays(today, 11)];
    await open(from);
    await open(to);
    const { id, token } = await bookingOn(from, { is_read: true });
    const pending = await created.sms({ booking_id: id, template: "reminder", dedupe_key: `${id}:reminder:${from}` });

    const v = ok(await reschedule(token, to, await windowId()));
    expect(v).toMatchObject({ date: to, status: "booked", can_change: true, change_until: `${addDays(to, -1)}T17:00` });

    expect(await row(id)).toMatchObject({ drop_off_date: to, status: "booked", is_read: false });
    expect((await db.from("booking_tokens").select("expires_on").eq("booking_id", id).single()).data).toEqual({ expires_on: addDays(to, 7) });
    expect(await lastEvent(id)).toEqual({ actor: "customer", action: "rescheduled", details: { from, to, notify: true } });
    const texts = await sms(id);
    expect(texts.find((t) => t.template === "reminder")).toMatchObject({ status: "cancelled" });
    expect(texts.find((t) => t.template === "rescheduled")).toMatchObject({ status: "pending", dedupe_key: `${id}:rescheduled:1` });
    expect(pending).toBeTruthy();
    expect(ok(await view(token)).date).toBe(to); // the link still works
  });

  it("a full day → FULL; a closed day → CLOSED; too far ahead → OUTSIDE_HORIZON; today → CUTOFF_PASSED", async () => {
    const from = addDays(today, 10);
    const full = addDays(today, 12);
    const closed = addDays(today, 13);
    await open(from);
    await open(full, 1);
    await created.override({ date: closed, is_open: false, reason: "Test closed" });
    await created.booking(full, "booked");
    const { id, token } = await bookingOn(from);
    const w = await windowId();

    expect(await reschedule(token, full, w)).toMatchObject({ ok: false, code: "FULL" });
    expect(await reschedule(token, closed, w)).toMatchObject({ ok: false, code: "CLOSED" });
    expect(await reschedule(token, addDays(today, 400), w)).toMatchObject({ ok: false, code: "OUTSIDE_HORIZON" });
    expect(await reschedule(token, today, w)).toMatchObject({ ok: false, code: "CUTOFF_PASSED" });
    expect(await reschedule(token, addDays(today, -3), w)).toMatchObject({ ok: false, code: "CLOSED" });
    expect((await row(id)).drop_off_date).toBe(from);
    expect(await sms(id)).toEqual([]);
  });

  it("the booking's own cutoff passed → CUTOFF_PASSED; not booked → INVALID_TRANSITION", async () => {
    const to = addDays(today, 12);
    await open(to);
    const late = await bookingOn(today);
    expect(await reschedule(late.token, to, await windowId())).toMatchObject({ ok: false, code: "CUTOFF_PASSED" });
    const cancelled = await created.booking(addDays(today, 10), "cancelled");
    expect(await reschedule(created.tokenOf(cancelled), to, await windowId())).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });

  it("same rego already booked that day → DUPLICATE_BOOKING; same day → INVALID_TRANSITION; bad window → VALIDATION", async () => {
    const [from, to] = [addDays(today, 10), addDays(today, 11)];
    await open(from);
    await open(to);
    const rego = testRego();
    await created.booking(to, "booked", { rego });
    const { token } = await bookingOn(from);
    // the same rego booked on another day, moving onto `to` where it's already booked
    await open(addDays(today, 14));
    const other = await bookingOn(addDays(today, 14), { rego });

    expect(await reschedule(other.token, to, await windowId())).toMatchObject({ ok: false, code: "DUPLICATE_BOOKING", details: to });
    expect(await reschedule(token, from, await windowId())).toMatchObject({ ok: false, code: "INVALID_TRANSITION", details: "unchanged" });
    expect(await reschedule(token, to, crypto.randomUUID())).toMatchObject({ ok: false, code: "VALIDATION", details: "window_id" });
  });

  it("race: two customers move into the last spot at once → one gets it, the other FULL", async () => {
    const [a, b, to] = [addDays(today, 10), addDays(today, 11), addDays(today, 15)];
    await open(a);
    await open(b);
    await open(to, 1);
    const x = await bookingOn(a);
    const y = await bookingOn(b);
    const w = await windowId();
    const results = await Promise.all([reschedule(x.token, to, w), reschedule(y.token, to, w)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ code: "FULL" });
  });
});

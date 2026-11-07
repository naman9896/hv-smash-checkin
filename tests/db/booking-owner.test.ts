// T4: owner actions from the dashboard (BUSINESS_RULES §7, API_SPEC §2). All calls run as the
// signed-in owner (authenticated); the service role only seeds and inspects rows.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDays, bookingIds, create, Created, ownerClient, randomFarMonday, serviceClient, sydney, sydneyToday, validInput,
} from "./booking-helpers";
import { formatDay } from "../../src/lib/booking/format";

const db = serviceClient();
let owner: SupabaseClient;
const created = new Created(db);
const checkins: string[] = [];
let serviceId: string;
let windowId: string;

beforeAll(async () => {
  owner = await ownerClient();
  const ids = await bookingIds(db);
  serviceId = ids.services[0].id;
  windowId = ids.windowId;
});
afterEach(async () => {
  await created.cleanup();
  if (checkins.length) await db.from("checkins").delete().in("id", checkins.splice(0));
});
afterAll(() => created.cleanup());

type Result = { ok: true; data: Record<string, unknown> } | { ok: false; code: string; details: string | null };

async function call(fn: string, args: Record<string, unknown>, client: SupabaseClient = owner): Promise<Result> {
  const { data, error } = await client.rpc(fn, args);
  if (error) return { ok: false, code: error.message, details: error.details ?? null };
  return { ok: true, data };
}
const setStatus = (id: string, status: string) => call("booking_owner_set_status", { p_id: id, p_status: status });
const cancel = (id: string, notify = true) => call("booking_owner_cancel", { p_id: id, p_notify: notify });
const reschedule = (id: string, date: string, opts: { allowOver?: boolean; notify?: boolean; window?: string } = {}) =>
  call("booking_owner_reschedule", {
    p_id: id, p_date: date, p_window_id: opts.window ?? windowId, p_allow_over: opts.allowOver ?? false, p_notify: opts.notify ?? true,
  });
const link = (id: string, checkinId: string | null) => call("booking_link_checkin", { p_id: id, p_checkin_id: checkinId });

/** A real booking made the way the owner would (booking_create, source owner) on a far Tuesday by default. */
async function booking(date = addDays(randomFarMonday(), 1), over: Record<string, unknown> = {}) {
  const r = await create(db, validInput({ serviceId, windowId, date }, over), "owner");
  if (!r.ok) throw new Error(`create: ${r.code}`);
  created.track(r.data.id);
  return r.data;
}

async function row(id: string) {
  const { data } = await db.from("bookings").select("*").eq("id", id).single();
  return data!;
}
async function events(id: string) {
  const { data } = await db.from("booking_events").select("actor, action, details").eq("booking_id", id).order("at");
  return data!;
}
async function sms(id: string, template?: string) {
  let q = db.from("sms_outbox").select("id, template, body, status, dedupe_key, last_error").eq("booking_id", id).order("created_at");
  if (template) q = q.eq("template", template);
  return (await q).data!;
}
async function checkin(rego: string): Promise<string> {
  const { data, error } = await db
    .from("checkins")
    .insert({ first_name: "Test", last_name: "Checkin", phone: "0400000000", make: "Toyota", model: "Corolla", rego: rego.slice(-7) })
    .select("id")
    .single();
  if (error) throw new Error(`checkin: ${error.message}`);
  checkins.push(data.id);
  return data.id;
}

describe("status changes (forward)", () => {
  it("booked → arrived → completed, each recorded as an owner event", async () => {
    const b = await booking();
    expect((await setStatus(b.id, "arrived")).ok).toBe(true);
    expect((await row(b.id)).status).toBe("arrived");
    expect((await setStatus(b.id, "completed")).ok).toBe(true);
    expect((await row(b.id)).status).toBe("completed");
    const ev = (await events(b.id)).filter((e) => e.actor === "owner" && e.action !== "created");
    expect(ev.map((e) => e.action)).toEqual(["arrived", "completed"]);
  });

  it.each([
    ["booked", "completed"],
    ["arrived", "no_show"],
    ["booked", "cancelled"], // cancelling goes through booking_owner_cancel
  ])("%s → %s is refused", async (from, to) => {
    const b = await booking();
    if (from === "arrived") await setStatus(b.id, "arrived");
    expect(await setStatus(b.id, to)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect((await row(b.id)).status).toBe(from);
  });

  it("unknown status → VALIDATION; unknown booking → NOT_FOUND", async () => {
    const b = await booking();
    expect(await setStatus(b.id, "done")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await setStatus(crypto.randomUUID(), "arrived")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("no-show only on or after the drop-off day", async () => {
    const future = await booking();
    expect(await setStatus(future.id, "no_show")).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });

    const past = await created.booking(addDays(sydneyToday(), -1));
    expect((await setStatus(past, "no_show")).ok).toBe(true);
    expect((await row(past)).status).toBe("no_show");
  });
});

describe("undo (owner only, no SMS)", () => {
  it("completed → arrived → booked, recorded as 'reverted'", async () => {
    const b = await booking();
    await setStatus(b.id, "arrived");
    await setStatus(b.id, "completed");
    expect((await setStatus(b.id, "arrived")).ok).toBe(true);
    expect((await setStatus(b.id, "booked")).ok).toBe(true);
    expect((await row(b.id)).status).toBe("booked");
    const reverted = (await events(b.id)).filter((e) => e.action === "reverted");
    expect(reverted.map((e) => e.details)).toEqual([{ from: "completed", to: "arrived" }, { from: "arrived", to: "booked" }]);
  });

  it("no-show → booked", async () => {
    const past = await created.booking(addDays(sydneyToday(), -1));
    await setStatus(past, "no_show");
    expect((await setStatus(past, "booked")).ok).toBe(true);
  });

  it("cancelled → booked clears cancelled_at and sends nothing", async () => {
    const b = await booking();
    await cancel(b.id, false);
    expect((await setStatus(b.id, "booked")).ok).toBe(true);
    expect(await row(b.id)).toMatchObject({ status: "booked", cancelled_at: null });
    expect(await sms(b.id, "cancelled")).toEqual([]);
  });

  it("re-opening a cancelled booking when the car is booked again that day → DUPLICATE_BOOKING", async () => {
    const date = addDays(randomFarMonday(), 1);
    const first = await booking(date);
    await cancel(first.id, false);
    const { rego } = await row(first.id);
    await booking(date, { rego });
    expect(await setStatus(first.id, "booked")).toMatchObject({ ok: false, code: "DUPLICATE_BOOKING", details: date });
  });

  it("re-opening a cancelled booking on a day that has filled up overbooks it (flagged)", async () => {
    const date = addDays(randomFarMonday(), 1);
    await created.override({ date, is_open: true, capacity_cars: 1 });
    const first = await booking(date);
    await cancel(first.id, false);
    await booking(date); // takes the only spot
    expect((await setStatus(first.id, "booked")).ok).toBe(true);
    expect((await row(first.id)).over_capacity).toBe(true);
    expect((await events(first.id)).map((e) => e.action)).toContain("overbooked");
  });

  it("arrived → booked removes the check-in link", async () => {
    const b = await booking();
    const c = await checkin((await row(b.id)).rego);
    await link(b.id, c);
    expect((await setStatus(b.id, "booked")).ok).toBe(true);
    expect(await row(b.id)).toMatchObject({ status: "booked", checkin_id: null });
  });
});

describe("cancel", () => {
  it("with notify: cancelled + cancellation SMS with the booking page placeholder (no token)", async () => {
    const b = await booking();
    expect((await cancel(b.id, true)).ok).toBe(true);
    const r = await row(b.id);
    expect(r.status).toBe("cancelled");
    expect(r.cancelled_at).not.toBeNull();
    const [s] = await sms(b.id, "cancelled");
    expect(s.dedupe_key).toBe(`${b.id}:cancelled:1`);
    expect(s.body).toBe(`Your booking for ${formatDay(b.date)} at Sai Motor Works is cancelled. To rebook: {booking_page}`);
    expect(s.body).not.toContain(b.token);
    expect((await events(b.id)).at(-1)).toMatchObject({ actor: "owner", action: "cancelled", details: { notify: true } });
  });

  it("without notify: no SMS", async () => {
    const b = await booking();
    await cancel(b.id, false);
    expect(await sms(b.id, "cancelled")).toEqual([]);
  });

  it("only a 'booked' booking can be cancelled", async () => {
    const b = await booking();
    await cancel(b.id);
    expect(await cancel(b.id)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    const a = await booking();
    await setStatus(a.id, "arrived");
    expect(await cancel(a.id)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(await cancel(crypto.randomUUID())).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("cancel → undo → cancel again sends a second cancellation SMS", async () => {
    const b = await booking();
    await cancel(b.id);
    await setStatus(b.id, "booked");
    await cancel(b.id);
    expect((await sms(b.id, "cancelled")).map((s) => s.dedupe_key)).toEqual([`${b.id}:cancelled:1`, `${b.id}:cancelled:2`]);
  });
});

describe("reschedule", () => {
  it("moves the booking, keeps the link, sends 'rescheduled' and drops unsent SMS for the old date", async () => {
    const from = addDays(randomFarMonday(), 1);
    const to = addDays(from, 7);
    const b = await booking(from);
    await created.sms({ booking_id: b.id, template: "reminder", body: "R {manage_link}", dedupe_key: `${b.id}:reminder:${from}` });

    expect((await reschedule(b.id, to)).ok).toBe(true);
    expect(await row(b.id)).toMatchObject({ status: "booked", drop_off_date: to, over_capacity: false });

    const all = await sms(b.id);
    expect(all.find((s) => s.template === "confirmation")).toMatchObject({ status: "cancelled", last_error: "Booking was rescheduled" });
    expect(all.find((s) => s.template === "reminder")).toMatchObject({ status: "cancelled", last_error: "Booking was rescheduled" });
    const re = all.find((s) => s.template === "rescheduled")!;
    expect(re).toMatchObject({ status: "pending", dedupe_key: `${b.id}:rescheduled:1` });
    expect(re.body).toBe(`Your booking at Sai Motor Works is now ${formatDay(to)}, drop off 8:30–9:30am. Manage: {manage_link}`);

    const { data: tok } = await db.from("booking_tokens").select("token, expires_on").eq("booking_id", b.id).single();
    expect(tok).toEqual({ token: b.token, expires_on: addDays(to, 7) }); // same link, new expiry
    expect((await events(b.id)).at(-1)).toMatchObject({ action: "rescheduled", details: { from, to } });
  });

  it("the new date still gets its reminder (one per booking per date)", async () => {
    const from = addDays(randomFarMonday(), 1);
    const to = addDays(from, 7);
    const b = await booking(from);
    await db.rpc("booking_enqueue_reminders_at", { p_now: sydney(addDays(from, -1), "10:00") });
    await reschedule(b.id, to, { notify: false });
    await db.rpc("booking_enqueue_reminders_at", { p_now: sydney(addDays(to, -1), "10:00") });
    expect((await sms(b.id, "reminder")).map((s) => s.dedupe_key)).toEqual([`${b.id}:reminder:${from}`, `${b.id}:reminder:${to}`]);
  });

  it("without notify: no SMS", async () => {
    const b = await booking();
    await reschedule(b.id, addDays(b.date, 7), { notify: false });
    expect(await sms(b.id, "rescheduled")).toEqual([]);
  });

  it("a full day needs allow_over, and is then flagged", async () => {
    const to = addDays(randomFarMonday(), 8);
    await created.override({ date: to, is_open: true, capacity_cars: 1 });
    await booking(to);
    const b = await booking();
    expect(await reschedule(b.id, to)).toMatchObject({ ok: false, code: "FULL" });
    expect((await row(b.id)).drop_off_date).toBe(b.date);
    expect((await reschedule(b.id, to, { allowOver: true })).ok).toBe(true);
    expect(await row(b.id)).toMatchObject({ drop_off_date: to, over_capacity: true });
    expect((await events(b.id)).map((e) => e.action)).toContain("overbooked");
  });

  it("closed days and past days are refused", async () => {
    const b = await booking();
    const closed = addDays(randomFarMonday(), 9);
    await created.override({ date: closed, is_open: false, reason: "Test closed" });
    expect(await reschedule(b.id, closed)).toMatchObject({ ok: false, code: "CLOSED" });
    expect(await reschedule(b.id, addDays(sydneyToday(), -1))).toMatchObject({ ok: false, code: "CLOSED" });
  });

  it("the same car already booked on the new day → DUPLICATE_BOOKING", async () => {
    const b = await booking();
    const to = addDays(b.date, 7);
    await booking(to, { rego: (await row(b.id)).rego });
    expect(await reschedule(b.id, to)).toMatchObject({ ok: false, code: "DUPLICATE_BOOKING", details: to });
  });

  it("only 'booked' bookings; bad window → VALIDATION", async () => {
    const b = await booking();
    expect(await reschedule(b.id, b.date, { window: crypto.randomUUID() })).toMatchObject({ ok: false, code: "VALIDATION" });
    await setStatus(b.id, "arrived");
    expect(await reschedule(b.id, addDays(b.date, 7))).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });

  it("two reschedules racing for the last spot: exactly one wins", async () => {
    const to = addDays(randomFarMonday(), 8);
    await created.override({ date: to, is_open: true, capacity_cars: 1 });
    const [a, b] = await Promise.all([booking(), booking()]);
    const results = await Promise.all([reschedule(a.id, to), reschedule(b.id, to)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ code: "FULL" });
  });
});

describe("link check-in", () => {
  it("linking marks a booked booking arrived; unlinking keeps the status", async () => {
    const b = await booking();
    const c = await checkin((await row(b.id)).rego);
    expect((await link(b.id, c)).ok).toBe(true);
    expect(await row(b.id)).toMatchObject({ status: "arrived", checkin_id: c });
    expect((await events(b.id)).map((e) => e.action).slice(-2)).toEqual(["linked_checkin", "arrived"]);

    expect((await link(b.id, null)).ok).toBe(true);
    expect(await row(b.id)).toMatchObject({ status: "arrived", checkin_id: null });
  });

  it("a check-in already linked to another booking is refused", async () => {
    const a = await booking();
    const b = await booking();
    const c = await checkin((await row(a.id)).rego);
    await link(a.id, c);
    expect(await link(b.id, c)).toMatchObject({ ok: false, code: "VALIDATION", details: "checkin_id" });
  });

  it("unknown check-in → NOT_FOUND; cancelled booking → INVALID_TRANSITION", async () => {
    const b = await booking();
    expect(await link(b.id, crypto.randomUUID())).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const c = await checkin((await row(b.id)).rego);
    await cancel(b.id, false);
    expect(await link(b.id, c)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });
});

describe("retry SMS", () => {
  it("a failed SMS goes back to pending with fresh attempts", async () => {
    const b = await booking();
    const [conf] = await sms(b.id, "confirmation");
    await db.from("sms_outbox").update({ status: "failed", attempts: 3, last_error: "ClickSend: INVALID_RECIPIENT" }).eq("id", conf.id);
    expect((await call("booking_retry_sms", { p_outbox_id: conf.id })).ok).toBe(true);
    const { data } = await db.from("sms_outbox").select("status, attempts").eq("id", conf.id).single();
    expect(data).toEqual({ status: "pending", attempts: 0 });
    expect((await events(b.id)).at(-1)).toMatchObject({ actor: "owner", action: "sms_retry", details: { template: "confirmation" } });
  });

  it("only failed rows; unknown → NOT_FOUND", async () => {
    const b = await booking();
    const [conf] = await sms(b.id, "confirmation");
    expect(await call("booking_retry_sms", { p_outbox_id: conf.id })).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(await call("booking_retry_sms", { p_outbox_id: crypto.randomUUID() })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

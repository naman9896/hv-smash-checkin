// T6: kiosk check-ins ↔ bookings (BUSINESS_RULES §7–8, §10) and the ready SMS.
// Check-ins are made the real way (anon → kiosk_submit_checkin), so the triggers run as they
// do at the workshop. Kiosk regos are at most 7 characters, so these tests use their own.
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, anonClient, Created, ownerClient, serviceClient, sydneyToday, testMobile } from "./booking-helpers";

const db = serviceClient();
const anon = anonClient();
let owner: SupabaseClient;
const created = new Created(db);
const checkins: string[] = [];
let savedMode: string;

beforeAll(async () => {
  owner = await ownerClient();
  savedMode = (await db.from("booking_settings").select("ready_sms_mode").eq("id", 1).single()).data!.ready_sms_mode;
});
afterEach(async () => {
  await db.from("booking_test_faults").delete().neq("name", "");
  await db.from("booking_settings").update({ ready_sms_mode: savedMode }).eq("id", 1);
  if (checkins.length) await db.from("sms_outbox").delete().in("checkin_id", checkins);
  await created.cleanup();
  if (checkins.length) await db.from("checkins").delete().in("id", checkins.splice(0));
});
afterAll(() => created.cleanup());

/** A 7-character rego no other run will use. */
const kioskRego = () => `Q${randomBytes(4).toString("hex").toUpperCase().slice(0, 6)}`;
const local = (e164: string) => `0${e164.slice(3, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}`;

/** Check in at the kiosk (anon), as a customer would. */
async function kiosk(over: { rego?: string; phone?: string; first?: string } = {}): Promise<{ id: string; ref: string }> {
  const id = crypto.randomUUID();
  const { data, error } = await anon.rpc("kiosk_submit_checkin", {
    p_id: id, p_first_name: over.first ?? "Kiosk", p_last_name: "Customer", p_phone: over.phone ?? local(testMobile()),
    p_email: "kiosk@example.com", p_make: "Toyota", p_model: "Corolla", p_year: null, p_rego: over.rego ?? kioskRego(),
    p_colour: null, p_odometer_km: null, p_signature_path: null, p_signed_at: new Date().toISOString(),
  });
  if (error) throw new Error(`kiosk: ${error.message}`);
  checkins.push(id);
  return { id, ref: data as string };
}

/** A booking for today (inserted directly: today may be closed for online booking). */
const bookingToday = (extra: Record<string, unknown> = {}, status = "booked") => created.booking(sydneyToday(), status, extra);

async function booking(id: string) {
  return (await db.from("bookings").select("status, checkin_id").eq("id", id).single()).data!;
}
async function events(id: string) {
  return (await db.from("booking_events").select("actor, action, details").eq("booking_id", id).order("at")).data!;
}
async function readySms(where: { booking_id?: string; checkin_id?: string }) {
  let q = db.from("sms_outbox").select("body, booking_id, checkin_id, dedupe_key, status").eq("template", "ready").order("created_at");
  if (where.booking_id) q = q.eq("booking_id", where.booking_id);
  if (where.checkin_id) q = q.eq("checkin_id", where.checkin_id);
  return (await q).data!;
}

type Result = { ok: true; data: unknown } | { ok: false; code: string; details: string | null };
async function call(fn: string, args: Record<string, unknown>): Promise<Result> {
  const { data, error } = await owner.rpc(fn, args);
  return error ? { ok: false, code: error.message, details: error.details ?? null } : { ok: true, data };
}
const readyFromBooking = (id: string, resend = false) => call("booking_send_ready_sms", { p_id: id, p_resend: resend });
const readyFromCheckin = (id: string, resend = false) => call("booking_checkin_ready_sms", { p_checkin_id: id, p_resend: resend });

describe("kiosk check-in finds today's booking", () => {
  it("same rego (any format) → booking arrived and linked, recorded as system", async () => {
    const rego = kioskRego();
    const b = await bookingToday({ rego });
    const c = await kiosk({ rego: `${rego.slice(0, 3).toLowerCase()}-${rego.slice(3)}` });
    expect(await booking(b)).toEqual({ status: "arrived", checkin_id: c.id });
    expect((await events(b)).slice(-2)).toEqual([
      { actor: "system", action: "linked_checkin", details: { checkin_id: c.id, via: "kiosk" } },
      { actor: "system", action: "arrived", details: { via: "kiosk" } },
    ]);
  });

  it("else the same mobile (typed with spaces at the kiosk)", async () => {
    const mobile = testMobile();
    const b = await bookingToday({ rego: kioskRego(), mobile });
    const c = await kiosk({ phone: local(mobile) });
    expect(await booking(b)).toEqual({ status: "arrived", checkin_id: c.id });
  });

  it("rego beats mobile; of two matches the earliest booking wins", async () => {
    const mobile = testMobile();
    const rego = kioskRego();
    const byMobileOld = await bookingToday({ rego: kioskRego(), mobile, created_at: "2026-01-01T00:00:00Z" });
    const byRego = await bookingToday({ rego });
    await kiosk({ rego, phone: local(mobile) });
    expect((await booking(byRego)).status).toBe("arrived");
    expect((await booking(byMobileOld)).status).toBe("booked");

    const m2 = testMobile();
    const early = await bookingToday({ rego: kioskRego(), mobile: m2, created_at: "2026-01-01T00:00:00Z" });
    const late = await bookingToday({ rego: kioskRego(), mobile: m2, created_at: "2026-02-01T00:00:00Z" });
    await kiosk({ phone: m2 });
    expect((await booking(early)).status).toBe("arrived");
    expect((await booking(late)).status).toBe("booked");
  });

  it("no match: another day, a cancelled booking, or nothing at all → plain walk-in", async () => {
    const rego = kioskRego();
    const tomorrow = await created.booking(addDays(sydneyToday(), 1), "booked", { rego });
    const cancelled = await bookingToday({ rego }, "cancelled");
    const c = await kiosk({ rego });
    expect((await booking(tomorrow)).status).toBe("booked");
    expect((await booking(cancelled)).status).toBe("cancelled");
    expect((await db.from("bookings").select("id").eq("checkin_id", c.id)).data).toEqual([]);
  });

  it("a trigger error never blocks a kiosk submit", async () => {
    const rego = kioskRego();
    const b = await bookingToday({ rego });
    await db.from("booking_test_faults").insert({ name: "checkin_link" });
    const c = await kiosk({ rego });
    expect(c.ref).toMatch(/^SMW-\d+$/);
    expect((await db.from("checkins").select("id").eq("id", c.id)).data).toHaveLength(1);
    expect(await booking(b)).toEqual({ status: "booked", checkin_id: null });
  });
});

describe("check-in completed → booking completed", () => {
  async function arrivedPair() {
    const rego = kioskRego();
    const b = await bookingToday({ rego, first_name: "Ada" });
    const c = await kiosk({ rego });
    return { b, c };
  }
  const complete = (checkinId: string, status = "completed") => db.from("checkins").update({ status }).eq("id", checkinId);

  it("default 'manual' mode: booking completed, no SMS", async () => {
    await db.from("booking_settings").update({ ready_sms_mode: "manual" }).eq("id", 1);
    const { b, c } = await arrivedPair();
    expect((await complete(c.id)).error).toBeNull();
    expect((await booking(b)).status).toBe("completed");
    expect((await events(b)).at(-1)).toMatchObject({ actor: "system", action: "completed" });
    expect(await readySms({ booking_id: b })).toEqual([]);
  });

  it("'on_complete' mode: exactly one ready SMS, even if completed twice", async () => {
    await db.from("booking_settings").update({ ready_sms_mode: "on_complete" }).eq("id", 1);
    const { b, c } = await arrivedPair();
    await complete(c.id);
    await complete(c.id, "in_progress");
    await complete(c.id);
    const sms = await readySms({ booking_id: b });
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ checkin_id: c.id, dedupe_key: `ready:${c.id}:1`, status: "pending" });
    expect(sms[0].body).toMatch(/^Hi Ada, your Q[A-Z0-9]{6} is ready for pickup at Sai Motor Works\./);
  });

  it("a trigger error never blocks saving the check-in", async () => {
    const { b, c } = await arrivedPair();
    await db.from("booking_test_faults").insert({ name: "checkin_complete" });
    expect((await complete(c.id)).error).toBeNull();
    expect((await db.from("checkins").select("status").eq("id", c.id).single()).data).toEqual({ status: "completed" });
    expect((await booking(b)).status).toBe("arrived");
  });
});

describe("Send ready SMS button", () => {
  it("booking: only once arrived; a second press needs resend", async () => {
    const b = await bookingToday({ rego: kioskRego(), first_name: "Ada" });
    expect(await readyFromBooking(b)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    await db.from("bookings").update({ status: "arrived" }).eq("id", b);

    expect(await readyFromBooking(b)).toMatchObject({ ok: true });
    expect(await readyFromBooking(b)).toMatchObject({ ok: false, code: "INVALID_TRANSITION", details: "already_sent" });
    expect(await readyFromBooking(b, true)).toMatchObject({ ok: true });
    expect((await readySms({ booking_id: b })).map((s) => s.dedupe_key)).toEqual([`ready:${b}:1`, `ready:${b}:2`]);
  });

  it("a linked booking and its check-in share one key: never sent twice by accident", async () => {
    const rego = kioskRego();
    const b = await bookingToday({ rego });
    const c = await kiosk({ rego });
    expect(await readyFromCheckin(c.id)).toMatchObject({ ok: true });
    expect(await readyFromBooking(b)).toMatchObject({ ok: false, details: "already_sent" });
    const sms = await readySms({ booking_id: b });
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ booking_id: b, checkin_id: c.id, dedupe_key: `ready:${c.id}:1` });
  });

  it("walk-in with a mobile → queued to that mobile", async () => {
    const mobile = testMobile();
    const c = await kiosk({ phone: local(mobile), first: "Walkin" });
    expect(await readyFromCheckin(c.id)).toMatchObject({ ok: true });
    const { data } = await db.from("sms_outbox").select("to_mobile, booking_id, body").eq("checkin_id", c.id).single();
    expect(data).toMatchObject({ to_mobile: mobile, booking_id: null });
    expect(data!.body).toMatch(/^Hi Walkin, your Q[A-Z0-9]{6} is ready for pickup/);
    expect(await readyFromCheckin(c.id)).toMatchObject({ ok: false, details: "already_sent" });
  });

  it("walk-in with a landline → 'not a mobile'; cancelled check-in → refused; unknown → NOT_FOUND", async () => {
    const landline = await kiosk({ phone: "02 4932 0000" });
    expect(await readyFromCheckin(landline.id)).toMatchObject({ ok: false, code: "VALIDATION", details: "not_mobile" });
    const c = await kiosk();
    await db.from("checkins").update({ status: "cancelled" }).eq("id", c.id);
    expect(await readyFromCheckin(c.id)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(await readyFromCheckin(crypto.randomUUID())).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

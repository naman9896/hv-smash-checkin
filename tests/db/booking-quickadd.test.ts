// T5: phone quick-add + send booking link (BUSINESS_RULES §12, API_SPEC §2). Calls run as the
// signed-in owner; the service role seeds and inspects.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDays, bookingIds, create, Created, ownerClient, randomFarMonday, serviceClient, sydneyToday, testMobile, testRego, validInput,
} from "./booking-helpers";

const db = serviceClient();
let owner: SupabaseClient;
const created = new Created(db);
const checkins: string[] = [];
const linkMobiles: string[] = [];
let serviceId: string;
let windowId: string;

beforeAll(async () => {
  owner = await ownerClient();
  const ids = await bookingIds(db);
  serviceId = ids.services[0].id;
  windowId = ids.windowId;
});
afterEach(async () => {
  if (linkMobiles.length) await db.from("sms_outbox").delete().eq("template", "booking_link").in("to_mobile", linkMobiles.splice(0));
  await created.cleanup();
  if (checkins.length) await db.from("checkins").delete().in("id", checkins.splice(0));
});

type Result = { ok: true; data: Record<string, unknown> | null } | { ok: false; code: string; details: string | null };
async function call(fn: string, args: Record<string, unknown>, client: SupabaseClient = owner): Promise<Result> {
  const { data, error } = await client.rpc(fn, args);
  if (error) return { ok: false, code: error.message, details: error.details ?? null };
  return { ok: true, data };
}
/** The data of a successful call (fails the test with the error code otherwise). */
function ok<T = Record<string, unknown>>(r: Result): T {
  if (!r.ok) throw new Error(`expected success, got ${r.code} (${r.details})`);
  return r.data as T;
}
const ownerCreate = (p: Record<string, unknown>, allowOver = false, sendSms = true) =>
  call("booking_owner_create", { p, p_allow_over: allowOver, p_send_sms: sendSms });
const lookup = (mobile: string) => call("booking_customer_lookup", { p_mobile: mobile });
const sendLink = (mobile: string) => call("booking_send_link", { p_mobile: mobile });

/** Local form of a +614… mobile, with spaces, as a customer types it at the kiosk. */
const local = (e164: string) => `0${e164.slice(3, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}`;

async function checkin(row: Record<string, unknown>): Promise<string> {
  const { data, error } = await db
    .from("checkins")
    .insert({ first_name: "Kiosk", last_name: "Person", phone: "0400000000", make: "Mazda", model: "3", rego: "KIO123", ...row })
    .select("id")
    .single();
  if (error) throw new Error(`checkin: ${error.message}`);
  checkins.push(data.id);
  return data.id;
}

describe("booking_owner_create (quick add)", () => {
  it("creates an owner booking: read already, no token to the browser, confirmation queued", async () => {
    const date = addDays(randomFarMonday(), 1);
    const r = await ownerCreate(validInput({ serviceId, windowId, date }));
    const data = ok(r);
    created.track(data.id as string);
    expect(Object.keys(data).sort()).toEqual(["date", "id", "reference_no"]);
    const { data: b } = await db.from("bookings").select("source, is_read, status").eq("id", data.id).single();
    expect(b).toEqual({ source: "owner", is_read: true, status: "booked" });
    const { data: sms } = await db.from("sms_outbox").select("template").eq("booking_id", data.id);
    expect(sms).toEqual([{ template: "confirmation" }]);
  });

  it("send_sms off: no confirmation", async () => {
    const r = await ownerCreate(validInput({ serviceId, windowId, date: addDays(randomFarMonday(), 1) }), false, false);
    const id = ok<{ id: string }>(r).id;
    created.track(id);
    expect((await db.from("sms_outbox").select("id").eq("booking_id", id)).data).toEqual([]);
  });

  it("same-day bookings are allowed for the owner", async () => {
    const today = sydneyToday();
    await created.override({ date: today, is_open: true, capacity_cars: 50 }); // open today whatever the weekday
    const r = await ownerCreate(validInput({ serviceId, windowId, date: today }));
    expect(r.ok).toBe(true);
    created.track(ok<{ id: string }>(r).id);
  });

  it("a full day needs allow_over, and is then flagged", async () => {
    const date = addDays(randomFarMonday(), 1);
    await created.override({ date, is_open: true, capacity_cars: 1 });
    const first = await create(db, validInput({ serviceId, windowId, date }), "owner");
    if (first.ok) created.track(first.data.id);
    expect(await ownerCreate(validInput({ serviceId, windowId, date }))).toMatchObject({ ok: false, code: "FULL" });
    const r = await ownerCreate(validInput({ serviceId, windowId, date }), true);
    expect(r.ok).toBe(true);
    const id = ok<{ id: string }>(r).id;
    created.track(id);
    expect((await db.from("bookings").select("over_capacity").eq("id", id).single()).data).toEqual({ over_capacity: true });
  });

  it("keeps booking_create's checks (validation, closed days, duplicate rego)", async () => {
    const date = addDays(randomFarMonday(), 1);
    expect(await ownerCreate(validInput({ serviceId, windowId, date }, { mobile: "02 4932 0000" }))).toMatchObject({ ok: false, code: "VALIDATION", details: "mobile" });
    expect(await ownerCreate(validInput({ serviceId, windowId, date: addDays(date, 5) }))).toMatchObject({ ok: false, code: "CLOSED" }); // Sunday
    const rego = testRego();
    const r = await ownerCreate(validInput({ serviceId, windowId, date }, { rego }));
    created.track(ok<{ id: string }>(r).id);
    expect(await ownerCreate(validInput({ serviceId, windowId, date }, { rego }))).toMatchObject({ ok: false, code: "DUPLICATE_BOOKING", details: date });
  });
});

describe("booking_customer_lookup (pre-fill)", () => {
  it("unknown mobile → null; not a mobile → VALIDATION", async () => {
    expect(await lookup(testMobile())).toEqual({ ok: true, data: null });
    expect(await lookup("02 4932 0000")).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("pre-fills from an earlier booking (any format of the mobile)", async () => {
    const mobile = testMobile();
    const rego = testRego();
    const r = await create(db, validInput({ serviceId, windowId, date: addDays(randomFarMonday(), 1) },
      { mobile, rego, first_name: "Ava", last_name: "Lee", email: "ava@example.com", make: "Kia", model: "Cerato", year: 2019 }), "owner");
    if (!r.ok) throw new Error(r.code);
    created.track(r.data.id);

    const res = await lookup(local(mobile));
    expect(res).toEqual({
      ok: true,
      data: {
        firstName: "Ava", lastName: "Lee", email: "ava@example.com", noShows: 0,
        vehicles: [{ rego, state: "NSW", make: "Kia", model: "Cerato", year: 2019 }],
      },
    });
  });

  it("pre-fills from a kiosk check-in (phone typed with spaces)", async () => {
    const mobile = testMobile();
    await checkin({ phone: local(mobile), first_name: "Ben", last_name: "Ray", email: "ben@example.com", rego: "ab-12cd", make: "Ford", model: "Focus", year: 2015 });
    expect(await lookup(mobile)).toEqual({
      ok: true,
      data: { firstName: "Ben", lastName: "Ray", email: "ben@example.com", noShows: 0, vehicles: [{ rego: "AB12CD", state: null, make: "Ford", model: "Focus", year: 2015 }] },
    });
  });

  it("newest name wins; every car listed once, newest first; no-shows counted", async () => {
    const mobile = testMobile();
    const oldRego = testRego();
    const r = await create(db, validInput({ serviceId, windowId, date: addDays(randomFarMonday(), 1) },
      { mobile, rego: oldRego, first_name: "Old", last_name: "Name" }), "owner");
    if (!r.ok) throw new Error(r.code);
    created.track(r.data.id);
    await db.from("bookings").update({ status: "no_show", created_at: "2026-01-01T00:00:00Z" }).eq("id", r.data.id);
    await checkin({ phone: mobile, first_name: "New", last_name: "Name", rego: "NEW1" });
    await checkin({ phone: mobile, first_name: "New", last_name: "Name", rego: "NEW1", created_at: "2026-02-01T00:00:00Z" });

    const res = await lookup(mobile);
    expect(res.ok && res.data).toMatchObject({ firstName: "New", lastName: "Name", noShows: 1 });
    const vehicles = ok<{ vehicles: { rego: string }[] }>(res).vehicles;
    expect(vehicles.map((v) => v.rego)).toEqual(["NEW1", oldRego]);
  });
});

describe("booking_send_link (Option B)", () => {
  it("queues the booking-page SMS; 5 per mobile per day, then RATE_LIMITED", async () => {
    const mobile = testMobile();
    linkMobiles.push(mobile);
    for (let i = 0; i < 5; i++) expect(await sendLink(local(mobile))).toEqual({ ok: true, data: { queued: true } });
    expect(await sendLink(mobile)).toMatchObject({ ok: false, code: "RATE_LIMITED" });

    const { data } = await db.from("sms_outbox").select("body, booking_id, status").eq("template", "booking_link").eq("to_mobile", mobile);
    expect(data).toHaveLength(5);
    expect(data![0]).toEqual({ body: "Hi, book your service with Sai Motor Works here: {booking_page}", booking_id: null, status: "pending" });
  });

  it("parallel sends can't get past the limit", async () => {
    const mobile = testMobile();
    linkMobiles.push(mobile);
    const results = await Promise.all(Array.from({ length: 8 }, () => sendLink(mobile)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });

  it("not a mobile → VALIDATION", async () => {
    expect(await sendLink("1300 017 205")).toMatchObject({ ok: false, code: "VALIDATION", details: "mobile" });
  });
});

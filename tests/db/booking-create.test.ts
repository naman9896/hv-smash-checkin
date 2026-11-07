// T2: booking_create + booking_public_info (BUSINESS_RULES §4–6, §10–11; DATA_MODEL §3).
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  addDays, bookingIds, create, Created, isoWeekday, openOnlineDate, randomFarMonday, serviceClient, sydneyToday,
  testMobile, testRego, validInput,
} from "./booking-helpers";

const db = serviceClient();
const created = new Created(db);
let serviceId: string;
let secondServiceId: string;
let windowId: string;
let onlineDate: string;

beforeAll(async () => {
  const ids = await bookingIds(db);
  serviceId = ids.services[0].id;
  secondServiceId = ids.services[1].id;
  windowId = ids.windowId;
  onlineDate = await openOnlineDate(db, 3);
});
afterEach(() => created.cleanup());
afterAll(() => created.cleanup());

const input = (date: string, over = {}) => validInput({ serviceId, windowId, date }, over);

async function mustCreate(...args: Parameters<typeof create>) {
  const r = await create(...args);
  if (!r.ok) throw new Error(`booking_create failed: ${r.code} ${r.details ?? ""}`);
  created.track(r.data.id);
  return r.data;
}

describe("online booking: happy path", () => {
  it("creates the booking, items, event, token and a queued confirmation SMS", async () => {
    const res = await mustCreate(db, input(onlineDate, {
      service_ids: [serviceId, secondServiceId],
      first_name: "  Sam ",
      mobile: "0412 345 678".replace("345 678", String(Math.floor(Math.random() * 1e6)).padStart(6, "0")),
      rego: "ab c-1 2",
      rego_state: "NSW",
      email: " Sam@Example.COM ",
      year: 2015,
      notes: "Squeaky brakes",
    }));

    expect(res.reference_no).toMatch(/^BKG-\d+$/);
    expect(res.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res).toMatchObject({ date: onlineDate, window_start: "08:30:00", window_end: "09:30:00" });

    const { data: b } = await db.from("bookings").select("*").eq("id", res.id).single();
    expect(b).toMatchObject({
      status: "booked", source: "online", drop_off_date: onlineDate, first_name: "Sam", rego: "ABC12",
      email: "sam@example.com", year: 2015, customer_notes: "Squeaky brakes", over_capacity: false,
    });
    expect(b.mobile).toMatch(/^\+614\d{8}$/);
    // Only the SHA-256 of the token is on the booking
    expect(b.manage_token_hash).toBe(`\\x${createHash("sha256").update(res.token).digest("hex")}`);

    const { data: items } = await db.from("booking_items").select("service_id, name_snapshot, price_type_snapshot, price_cents_snapshot").eq("booking_id", res.id);
    expect(items).toHaveLength(2);
    expect(items).toContainEqual({ service_id: serviceId, name_snapshot: "Basic service", price_type_snapshot: "from", price_cents_snapshot: 16000 });

    const { data: events } = await db.from("booking_events").select("actor, action").eq("booking_id", res.id);
    expect(events).toEqual([{ actor: "customer", action: "created" }]);

    // The raw token lives only in the locked booking_tokens table (for links in later SMS)
    const { data: tok } = await db.from("booking_tokens").select("token, expires_on").eq("booking_id", res.id).single();
    expect(tok).toEqual({ token: res.token, expires_on: addDays(onlineDate, 7) });

    const { data: sms } = await db.from("sms_outbox").select("*").eq("booking_id", res.id);
    expect(sms).toHaveLength(1);
    expect(sms![0]).toMatchObject({ template: "confirmation", status: "pending", attempts: 0, to_mobile: b.mobile, dedupe_key: `${res.id}:confirmation` });
    const body: string = sms![0].body;
    expect(body).toContain("Hi Sam, you're booked at Sai Motor Works for ");
    expect(body).toContain("drop off 8:30–9:30am");
    expect(body).toContain("Basic service, Logbook service");
    expect(body).toMatch(/Manage: \{manage_link\}$/);
    expect(body).not.toContain(res.token); // never at rest in the outbox (security review finding 2)
  });

  it("strips control characters and links from names before they reach an SMS", async () => {
    const res = await mustCreate(db, input(onlineDate, { first_name: "Jo\u0007 http://evil.example/x" }));
    const { data: sms } = await db.from("sms_outbox").select("body").eq("booking_id", res.id).single();
    expect(sms!.body.startsWith("Hi Jo, you're booked")).toBe(true);
  });
});

describe("capacity and the over-capacity race (BUSINESS_RULES §6)", () => {
  it("10 parallel requests for the last spot: exactly 1 succeeds, 9 get FULL", async () => {
    const d = randomFarMonday();
    await created.override({ date: d, is_open: true, capacity_cars: 1 });
    // Owner source (no online horizon) so a far-future test date works; capacity rules are the same
    const results = await Promise.all(Array.from({ length: 10 }, () => create(db, input(d), "owner")));
    for (const r of results) if (r.ok) created.track(r.data.id);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.code)).toEqual(Array(9).fill("FULL"));
  });

  it("the owner can overbook with allow_over; it is recorded", async () => {
    const d = randomFarMonday();
    await created.override({ date: d, is_open: true, capacity_cars: 1 });
    await mustCreate(db, input(d), "owner");
    const over = await mustCreate(db, input(d), "owner", true);
    const { data: b } = await db.from("bookings").select("over_capacity, source").eq("id", over.id).single();
    expect(b).toEqual({ over_capacity: true, source: "owner" });
    const { data: ev } = await db.from("booking_events").select("action").eq("booking_id", over.id).order("at");
    expect(ev!.map((e) => e.action)).toEqual(["created", "overbooked"]);
  });

  it("online bookings can never overbook", async () => {
    const r = await create(db, input(onlineDate), "online", true);
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("limits", () => {
  it("one active booking per rego per day (rego normalised), with the existing date", async () => {
    const d = randomFarMonday();
    const rego = testRego();
    await mustCreate(db, input(d, { rego }), "owner");
    const dup = await create(db, input(d, { rego: rego.toLowerCase().replace(/(.{3})/, "$1 ") }), "owner");
    expect(dup).toMatchObject({ ok: false, code: "DUPLICATE_BOOKING", details: d });
  });

  it("a cancelled booking doesn't block the same rego that day", async () => {
    const d = randomFarMonday();
    const rego = testRego();
    const first = await mustCreate(db, input(d, { rego }), "owner");
    await db.from("bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", first.id);
    await mustCreate(db, input(d, { rego }), "owner");
  });

  it("max 3 active future bookings per mobile online; cancelled ones don't count", async () => {
    const mobile = testMobile();
    const far = randomFarMonday();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await mustCreate(db, input(addDays(far, i), { mobile }), "owner")).id);

    expect(await create(db, input(onlineDate, { mobile }))).toMatchObject({ ok: false, code: "MOBILE_LIMIT" });

    await db.from("bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", ids[0]);
    await mustCreate(db, input(onlineDate, { mobile }));
  });
});

describe("services", () => {
  it("unknown, inactive and not-online services are NOT_FOUND", async () => {
    const { data: svc, error } = await db.from("booking_services")
      .insert({ name: `T2 test ${testRego()}`, price_type: "quote", active: false }).select("id").single();
    expect(error).toBeNull();
    const { data: offline } = await db.from("booking_services")
      .insert({ name: `T2 test ${testRego()}`, price_type: "quote", online_bookable: false }).select("id").single();
    try {
      expect(await create(db, input(onlineDate, { service_ids: [crypto.randomUUID()] }))).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await create(db, input(onlineDate, { service_ids: [svc!.id] }))).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(await create(db, input(onlineDate, { service_ids: [offline!.id] }))).toMatchObject({ ok: false, code: "NOT_FOUND" });
    } finally {
      await db.from("booking_services").delete().in("id", [svc!.id, offline!.id]);
    }
  });

  it("needs 1–5 different services", async () => {
    const { data: all } = await db.from("booking_services").select("id").eq("active", true).limit(6);
    expect(await create(db, input(onlineDate, { service_ids: [] }))).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await create(db, input(onlineDate, { service_ids: all!.map((s) => s.id) }))).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await create(db, input(onlineDate, { service_ids: [serviceId, serviceId] }))).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("validation (again in the DB, after Zod)", () => {
  it.each([
    ["an unknown field", { is_admin: true }],
    ["a landline", { mobile: "02 4932 1234" }],
    ["a bad rego", { rego: "TOOLONG1234" }],
    ["a bad state", { rego_state: "XX" }],
    ["an empty first name", { first_name: "   " }],
    ["a bad email", { email: "nope" }],
    ["a bad year", { year: 1800 }],
    ["notes over 1000 chars", { notes: "x".repeat(1001) }],
    ["an unknown window", { window_id: "00000000-0000-0000-0000-000000000000" }],
  ])("rejects %s", async (_label, over) => {
    expect(await create(db, input(onlineDate, over))).toMatchObject({ ok: false, code: "VALIDATION", sqlstate: "P0001" });
  });

  it("rejects an unknown source", async () => {
    const { error } = await db.rpc("booking_create", { p: input(onlineDate), p_source: "anon", p_allow_over: false });
    expect(error?.message).toBe("VALIDATION");
  });
});

describe("online date rules", () => {
  it("today is CUTOFF_PASSED (no same-day online bookings)", async () => {
    expect(await create(db, input(sydneyToday()))).toMatchObject({ ok: false, code: "CUTOFF_PASSED" });
  });

  it("beyond 30 days is OUTSIDE_HORIZON", async () => {
    expect(await create(db, input(addDays(sydneyToday(), 31)))).toMatchObject({ ok: false, code: "OUTSIDE_HORIZON" });
  });

  it("a Sunday is CLOSED", async () => {
    let d = addDays(sydneyToday(), 2);
    while (isoWeekday(d) !== 7) d = addDays(d, 1);
    expect(await create(db, input(d))).toMatchObject({ ok: false, code: "CLOSED" });
  });

  it("a past date is CLOSED, also for the owner", async () => {
    expect(await create(db, input(addDays(sydneyToday(), -1)), "owner")).toMatchObject({ ok: false, code: "CLOSED" });
  });

  it("the owner may book today (if open)", async () => {
    const today = sydneyToday();
    if (isoWeekday(today) === 7) return; // Sunday: closed anyway
    const { data: hol } = await db.from("booking_public_holidays").select("date").eq("date", today);
    if (hol!.length) return;
    const r = await create(db, input(today), "owner", true);
    if (r.ok) created.track(r.data.id);
    expect(r.ok).toBe(true);
  });
});

describe("booking_public_info", () => {
  it("returns only what the public page needs", async () => {
    const { data, error } = await db.rpc("booking_public_info");
    expect(error).toBeNull();
    expect(Object.keys(data).sort()).toEqual(
      ["business", "hours", "online_enabled", "pickup_message", "price_disclaimer", "services", "windows"].sort(),
    );
    expect(Object.keys(data.business).sort()).toEqual(["address", "name", "phone"]);
    expect(data.services[0]).toEqual({
      id: serviceId, name: "Basic service", description: "", price_type: "from", price_cents: 16000,
    });
    expect(data.windows).toEqual([{ id: windowId, start_time: "08:30:00", end_time: "09:30:00" }]);
    expect(data.hours).toHaveLength(7);
    expect(JSON.stringify(data)).not.toMatch(/pin_hash|staff|abn|sender|max_active/i);
  });
});

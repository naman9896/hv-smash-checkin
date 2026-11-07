// T1: booking_day + booking_availability (BUSINESS_RULES §1, §4, §5).
// Uses booking_availability_at(…, p_now) so "now" is fixed; booking_availability() is the
// same function with p_now = now().
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { addDays, availabilityAt, Created, dayAt, isoWeekday, randomFarMonday, serviceClient, sydney } from "./booking-helpers";

const db = serviceClient();
const created = new Created(db);

afterEach(() => created.cleanup());
afterAll(() => created.cleanup());

describe("seed data", () => {
  it("has the weekly hours from BUSINESS_RULES §1/§4", async () => {
    const { data, error } = await db.from("booking_weekly_hours").select("*").order("weekday");
    expect(error).toBeNull();
    expect(data).toHaveLength(7);
    const [mon, , , , fri, sat, sun] = data!;
    expect(mon).toMatchObject({ weekday: 1, is_open: true, open_time: "08:30:00", close_time: "17:00:00" });
    expect(fri).toMatchObject({ weekday: 5, is_open: true });
    expect(sat).toMatchObject({ weekday: 6, is_open: true, open_time: "08:30:00", close_time: "16:00:00" });
    expect(sun).toMatchObject({ weekday: 7, is_open: false });
  });

  it("has one drop-off window 08:30–09:30", async () => {
    const { data } = await db.from("booking_windows").select("start_time, end_time").eq("active", true);
    expect(data).toEqual([{ start_time: "08:30:00", end_time: "09:30:00" }]);
  });

  it("has the 8 services, only Basic service priced", async () => {
    const { data } = await db.from("booking_services").select("name, price_type, price_cents").order("sort_order");
    expect(data!.map((s) => s.name)).toEqual([
      "Basic service",
      "Logbook service",
      "Brakes",
      "Tyres",
      "Pink slip (e-Safety check)",
      "Diagnostics / warning light",
      "Air-con",
      "General repair (describe the problem)",
    ]);
    expect(data![0]).toMatchObject({ price_type: "from", price_cents: 16000 });
    expect(data!.slice(1).every((s) => s.price_type === "quote" && s.price_cents === null)).toBe(true);
  });

  it("has the settings row with the agreed defaults", async () => {
    const { data } = await db.from("booking_settings").select("*").single();
    expect(data).toMatchObject({
      id: 1,
      online_enabled: true,
      horizon_days: 30,
      online_cutoff_time: "17:00:00",
      cancel_cutoff_time: "17:00:00",
      reminder_time: "10:00:00",
      sms_sender_id: "SaiMotor",
      ready_sms_mode: "manual",
      max_active_per_mobile: 3,
    });
  });

  it("has the NSW public holidays for 2026–2027", async () => {
    const { data } = await db.from("booking_public_holidays").select("date").gte("date", "2026-01-01").lte("date", "2027-12-31");
    const dates = new Set(data!.map((h) => h.date));
    for (const d of ["2026-01-01", "2026-01-26", "2026-04-03", "2026-04-06", "2026-04-27", "2026-06-08", "2026-10-05",
      "2026-12-25", "2026-12-26", "2026-12-28", "2027-03-26", "2027-03-29", "2027-04-26", "2027-06-14", "2027-10-04",
      "2027-12-27", "2027-12-28"]) {
      expect(dates, d).toContain(d);
    }
    expect(dates).not.toContain("2026-08-03"); // Bank Holiday: banks only, workshop open
  });
});

describe("open and closed days", () => {
  const now = sydney("2027-06-01", "09:00");

  it("Sunday is closed (weekly hours)", async () => {
    const d = await dayAt(db, "2027-06-06", false, now);
    expect(isoWeekday("2027-06-06")).toBe(7);
    expect(d).toMatchObject({ status: "closed", reason: "weekly" });
  });

  it("a seeded public holiday is closed", async () => {
    const d = await dayAt(db, "2027-06-14", false, now);
    expect(d).toMatchObject({ status: "closed", reason: "holiday", note: "King's Birthday" });
  });

  it("an override opens a holiday: it must state its capacity (T8); hours fall back to the weekday", async () => {
    const h = randomFarMonday();
    const before = sydney(addDays(h, -7), "09:00");
    await created.holiday(h, "T1 test holiday");
    expect(await dayAt(db, h, false, before)).toMatchObject({ status: "closed", reason: "holiday" });

    // T8: an open override without a capacity is refused (it would otherwise depend on the weekday)
    const noCap = await db.from("booking_date_overrides").insert({ date: h, is_open: true, capacity_cars: null });
    expect(noCap.error?.code).toBe("23514");

    await created.override({ date: h, is_open: true, capacity_cars: 6, reason: "Open anyway" });
    expect(await dayAt(db, h, false, before)).toMatchObject({ status: "open", reason: null, capacity: 6, spots_left: 6 });
    const { data } = await db.rpc("booking_day", { d: h });
    expect(data[0]).toMatchObject({ open_time: "08:30:00", close_time: "17:00:00" }); // Monday's hours
  });

  it("an override can close a normal day or change its capacity", async () => {
    const m = randomFarMonday();
    const before = sydney(addDays(m, -7), "09:00");
    await created.override({ date: m, is_open: false, reason: "Christmas shutdown" });
    await created.override({ date: addDays(m, 1), is_open: true, capacity_cars: 3 });
    expect(await dayAt(db, m, false, before)).toMatchObject({
      status: "closed", reason: "override", note: "Christmas shutdown", spots_left: 0, // closed: never any spots
    });
    expect(await dayAt(db, addDays(m, 1), false, before)).toMatchObject({ status: "open", capacity: 3 });
  });

  it("Saturday capacity is 8, weekdays 10", async () => {
    const m = randomFarMonday();
    const rows = await availabilityAt(db, m, addDays(m, 6), false, sydney(addDays(m, -7), "09:00"));
    expect(rows.map((r) => r.capacity)).toEqual([10, 10, 10, 10, 10, 8, 0]);
    expect(rows.map((r) => r.status)).toEqual(["open", "open", "open", "open", "open", "open", "closed"]);
  });
});

describe("'call us' on days the owner closes (BUSINESS_RULES §1)", () => {
  it("only an owner-closed day with show_phone on offers the phone number", async () => {
    const m = randomFarMonday();
    const before = sydney(addDays(m, -7), "09:00");
    await created.override({ date: m, is_open: false, reason: "Away", show_phone: true });
    await created.override({ date: addDays(m, 1), is_open: false, reason: "Away" }); // default: off
    expect(await dayAt(db, m, true, before)).toMatchObject({ status: "closed", reason: "override", call_us: true });
    expect(await dayAt(db, addDays(m, 1), true, before)).toMatchObject({ status: "closed", reason: "override", call_us: false });
    // Normal open day, Sunday, full day: never
    expect((await dayAt(db, addDays(m, 2), true, before)).call_us).toBe(false);
    expect((await dayAt(db, addDays(m, 6), true, before)).call_us).toBe(false);
  });

  it("public holidays never offer the phone number", async () => {
    expect(await dayAt(db, "2027-06-14", true, sydney("2027-06-01", "09:00"))).toMatchObject({ reason: "holiday", call_us: false });
  });

  it("show_phone is only allowed on a closed override", async () => {
    const { error } = await db.from("booking_date_overrides").insert({ date: randomFarMonday(), is_open: true, show_phone: true });
    expect(error?.code).toBe("23514"); // check_violation
  });
});

describe("capacity", () => {
  it("is full after 10 active bookings; cancelled / no-show free a spot", async () => {
    const d = randomFarMonday();
    const now = sydney(addDays(d, -3), "09:00");

    const ids: string[] = [];
    for (let i = 0; i < 9; i++) ids.push(await created.booking(d, i < 3 ? ["booked", "arrived", "completed"][i] : "booked"));
    // Cancelled and no-show bookings on the same day never count
    await created.booking(d, "cancelled");
    await created.booking(d, "no_show");
    expect(await dayAt(db, d, true, now)).toMatchObject({ status: "open", capacity: 10, booked: 9, spots_left: 1 });

    ids.push(await created.booking(d));
    expect(await dayAt(db, d, true, now)).toMatchObject({ status: "full", booked: 10, spots_left: 0 });
    expect(await dayAt(db, d, false, now)).toMatchObject({ status: "full" }); // owner sees it full too (may still overbook)

    await db.from("bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", ids[9]);
    expect(await dayAt(db, d, true, now)).toMatchObject({ status: "open", booked: 9, spots_left: 1 });

    await created.booking(d);
    expect((await dayAt(db, d, true, now)).status).toBe("full");
    await db.from("bookings").update({ status: "no_show" }).eq("id", ids[8]);
    expect(await dayAt(db, d, true, now)).toMatchObject({ status: "open", spots_left: 1 });
  });

  it("an overbooked day reports 0 spots left, not a negative number", async () => {
    const d = randomFarMonday();
    await created.override({ date: d, is_open: true, capacity_cars: 1 });
    await created.booking(d);
    await created.booking(d);
    expect(await dayAt(db, d, false, sydney(addDays(d, -3), "09:00"))).toMatchObject({ status: "full", booked: 2, spots_left: 0 });
  });
});

describe("online limits: same day, cutoff, horizon", () => {
  const m = randomFarMonday(); // "today"

  it("no same-day online bookings; the owner may book today", async () => {
    const now = sydney(m, "09:00");
    expect(await dayAt(db, m, true, now)).toMatchObject({ status: "closed", reason: "same_day" });
    expect(await dayAt(db, m, false, now)).toMatchObject({ status: "open" });
  });

  it("past days are closed for everyone", async () => {
    const now = sydney(m, "09:00");
    expect(await dayAt(db, addDays(m, -1), true, now)).toMatchObject({ status: "closed", reason: "past" });
    expect(await dayAt(db, addDays(m, -1), false, now)).toMatchObject({ status: "closed", reason: "past" });
  });

  it("tomorrow closes at 17:00 today (Sydney); the owner ignores the cutoff", async () => {
    const tue = addDays(m, 1);
    expect(await dayAt(db, tue, true, sydney(m, "16:59"))).toMatchObject({ status: "open" });
    expect(await dayAt(db, tue, true, sydney(m, "17:00"))).toMatchObject({ status: "closed", reason: "cutoff", spots_left: 0 });
    expect(await dayAt(db, tue, false, sydney(m, "17:00"))).toMatchObject({ status: "open" });
    // The day after tomorrow is unaffected
    expect(await dayAt(db, addDays(m, 2), true, sydney(m, "17:00"))).toMatchObject({ status: "open" });
  });

  it("online bookings up to 30 days ahead; the owner ignores the horizon", async () => {
    const now = sydney(m, "09:00");
    expect(await dayAt(db, addDays(m, 30), true, now)).toMatchObject({ status: "open" });
    expect(await dayAt(db, addDays(m, 31), true, now)).toMatchObject({ status: "closed", reason: "horizon", spots_left: 0 });
    expect(await dayAt(db, addDays(m, 31), false, now)).toMatchObject({ status: "open" });
  });
});

describe("daylight saving", () => {
  // DST ends Sun 4 Apr 2027 at 03:00 AEDT (+11) → 02:00 AEST (+10). So 17:00 that Sunday is 07:00 UTC.
  // Code that assumed +11 (or UTC) would get the cutoff for Monday 5 Apr wrong.
  it("cutoff on the day DST ends uses AEST", async () => {
    expect(await dayAt(db, "2027-04-05", true, "2027-04-04T06:30:00Z")).toMatchObject({ status: "open" }); // 16:30 AEST
    expect(await dayAt(db, "2027-04-05", true, "2027-04-04T06:59:59Z")).toMatchObject({ status: "open" });
    expect(await dayAt(db, "2027-04-05", true, "2027-04-04T07:00:00Z")).toMatchObject({ status: "closed", reason: "cutoff" });
  });

  // DST starts Sun 4 Oct 2026 at 02:00 AEST. 13:30 UTC on Sat 3 Oct is 23:30 Sat AEST ("today" = Saturday);
  // 14:30 UTC is 00:30 Sun ("today" = Sunday, Saturday is past). In UTC both would still be Saturday.
  it("'today' follows Sydney, not UTC, around the DST start", async () => {
    expect(await dayAt(db, "2026-10-03", false, "2026-10-03T13:30:00Z")).toMatchObject({ reason: null }); // still Sat, owner can book
    expect(await dayAt(db, "2026-10-03", false, "2026-10-03T14:30:00Z")).toMatchObject({ reason: "past" }); // Sun 00:30
  });

  it("every date appears exactly once across a DST change", async () => {
    for (const [from, to] of [["2026-10-01", "2026-10-07"], ["2027-04-01", "2027-04-07"]]) {
      const rows = await availabilityAt(db, from, to, false, "2026-01-01T00:00:00Z");
      expect(rows.map((r) => r.day)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(from, i)));
    }
  });
});

describe("input checks", () => {
  it("rejects a reversed or too-long range", async () => {
    const now = new Date().toISOString();
    for (const [from, to] of [["2031-02-10", "2031-02-01"], ["2031-01-01", "2031-06-01"]]) {
      const { error } = await db.rpc("booking_availability_at", { p_from: from, p_to: to, p_online: true, p_now: now });
      expect(error?.code).toBe("22023");
    }
  });

  it("booking_availability() works with the real clock", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await db.rpc("booking_availability", { p_from: today, p_to: addDays(today, 6), p_online: true });
    expect(error).toBeNull();
    expect(data).toHaveLength(7);
  });
});

beforeAll(async () => {
  // Fail fast with a clear message if booking.sql hasn't been run on staging yet
  const { error } = await db.from("booking_settings").select("id").limit(1);
  if (error) throw new Error(`booking.sql not applied to staging? (${error.code})`);
});

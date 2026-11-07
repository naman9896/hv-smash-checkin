// T8: the owner's Online Booking settings (API_SPEC §2 "Booking settings", BUSINESS_RULES §1, §10).
// The owner edits through RLS + column grants; the DB check constraints are the last line.
// Every shared row this file changes is put back afterwards.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, Created, ownerClient, randomFarMonday, RUN, serviceClient } from "./booking-helpers";

const db = serviceClient();
let owner: SupabaseClient;
const created = new Created(db);
const CHECK = "23514";
const DENIED = "42501";

let savedSettings: Record<string, unknown>;
let savedSunday: Record<string, unknown>;
const services: string[] = [];
const windows: string[] = [];

beforeAll(async () => {
  owner = await ownerClient();
  savedSettings = (await db.from("booking_settings").select("*").eq("id", 1).single()).data!;
  savedSunday = (await db.from("booking_weekly_hours").select("*").eq("weekday", 7).single()).data!;
});
afterEach(async () => {
  const rest = { ...savedSettings };
  delete rest.id;
  delete rest.updated_at;
  await db.from("booking_settings").update(rest).eq("id", 1);
  await db.from("booking_weekly_hours").update(savedSunday).eq("weekday", 7);
  if (services.length) await db.from("booking_services").delete().in("id", services.splice(0));
  if (windows.length) await db.from("booking_windows").delete().in("id", windows.splice(0));
  await created.cleanup();
});
afterAll(() => created.cleanup());

describe("booking_settings", () => {
  it("the owner saves every editable field", async () => {
    const patch = {
      online_enabled: false, horizon_days: 45, online_cutoff_time: "16:00", cancel_cutoff_time: "15:30", reminder_time: "09:00",
      pickup_message: "We'll text you", price_disclaimer: "Prices vary", sms_sender_id: "SMW2", sms_enabled: false,
      ready_sms_mode: "on_complete", max_active_per_mobile: 5,
    };
    const { data, error } = await owner.from("booking_settings").update(patch).eq("id", 1).select().single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ ...patch, online_cutoff_time: "16:00:00", cancel_cutoff_time: "15:30:00", reminder_time: "09:00:00" });
  });

  it.each([
    [{ sms_sender_id: "Sai Motor" }],
    [{ sms_sender_id: "SaiMotorWorks1" }],
    [{ horizon_days: 0 }],
    [{ max_active_per_mobile: 21 }],
    [{ ready_sms_mode: "always" }],
    [{ pickup_message: "x".repeat(201) }],
  ])("rejects %j", async (patch) => {
    expect((await owner.from("booking_settings").update(patch).eq("id", 1)).error?.code).toBe(CHECK);
  });

  it("can't touch columns outside the grant", async () => {
    expect((await owner.from("booking_settings").update({ updated_at: new Date().toISOString() }).eq("id", 1)).error?.code).toBe(DENIED);
  });
});

describe("weekly hours", () => {
  it("open must be before close", async () => {
    expect((await owner.from("booking_weekly_hours").update({ open_time: "17:00", close_time: "08:30" }).eq("weekday", 7)).error?.code).toBe(CHECK);
  });

  it("opening a closed weekday (Sunday) needs a capacity, else it would show full", async () => {
    expect((await owner.from("booking_weekly_hours").update({ is_open: true, capacity_cars: 0 }).eq("weekday", 7)).error?.code).toBe(CHECK);
    expect((await owner.from("booking_weekly_hours").update({ is_open: true, capacity_cars: 4 }).eq("weekday", 7)).error).toBeNull();
    // ...and a closed day may keep 0
    expect((await owner.from("booking_weekly_hours").update({ is_open: false, capacity_cars: 0 }).eq("weekday", 7)).error).toBeNull();
  });
});

describe("closed and special dates", () => {
  const date = () => addDays(randomFarMonday(), 6); // a Sunday

  it("an open override must state its capacity", async () => {
    const d = date();
    created.overrides.push(d);
    expect((await owner.from("booking_date_overrides").insert({ date: d, is_open: true })).error?.code).toBe(CHECK);
    expect((await owner.from("booking_date_overrides").insert({ date: d, is_open: true, capacity_cars: 0 })).error?.code).toBe(CHECK);
    expect((await owner.from("booking_date_overrides").insert({ date: d, is_open: true, capacity_cars: 4 })).error).toBeNull();
    const { data } = await owner.rpc("booking_availability", { p_from: d, p_to: d, p_online: false });
    expect(data[0]).toMatchObject({ status: "open", capacity: 4 });
  });

  it("closed with a private reason + 'show my phone'; can be removed", async () => {
    const d = addDays(randomFarMonday(), 2);
    created.overrides.push(d);
    const ins = await owner.from("booking_date_overrides").insert({ date: d, is_open: false, reason: "Staff training", show_phone: true });
    expect(ins.error).toBeNull();
    expect((await owner.from("booking_date_overrides").insert({ date: addDays(d, 1), is_open: true, capacity_cars: 3, show_phone: true })).error?.code).toBe(CHECK);
    expect((await owner.from("booking_date_overrides").delete().eq("date", d)).error).toBeNull();
    expect((await db.from("booking_date_overrides").select("date").eq("date", d)).data).toEqual([]);
  });

  it("booking_on_date lists the active bookings on a day (so closing it warns)", async () => {
    const d = addDays(randomFarMonday(), 2);
    const a = await created.booking(d, "booked", { first_name: "Ada", last_name: "Lee" });
    const b = await created.booking(d, "arrived");
    await created.booking(d, "cancelled");
    await created.booking(d, "no_show");
    const { data, error } = await owner.rpc("booking_on_date", { p_date: d });
    expect(error).toBeNull();
    expect(data.map((r: { id: string }) => r.id).sort()).toEqual([a, b].sort());
    expect(Object.keys(data[0]).sort()).toEqual(["first_name", "id", "last_name", "reference_no", "rego", "status", "window_start"]);
    expect((await owner.rpc("booking_on_date", { p_date: addDays(d, 1) })).data).toEqual([]);
  });
});

describe("services", () => {
  const name = () => `Test service ${RUN} ${Math.random().toString(36).slice(2, 7)}`;

  it("add, edit, deactivate; never delete", async () => {
    const { data, error } = await owner.from("booking_services")
      .insert({ name: name(), price_type: "fixed", price_cents: 9900, sort_order: 999 }).select("id").single();
    expect(error).toBeNull();
    services.push(data!.id);
    expect((await owner.from("booking_services").update({ price_type: "quote", price_cents: null, active: false }).eq("id", data!.id)).error).toBeNull();
    expect((await owner.from("booking_services").delete().eq("id", data!.id)).error?.code).toBe(DENIED);
  });

  it("price must match its type", async () => {
    expect((await owner.from("booking_services").insert({ name: name(), price_type: "quote", price_cents: 100 })).error?.code).toBe(CHECK);
    expect((await owner.from("booking_services").insert({ name: name(), price_type: "fixed", price_cents: null })).error?.code).toBe(CHECK);
  });
});

describe("drop-off windows", () => {
  it("start must be before end; owner can add and remove", async () => {
    expect((await owner.from("booking_windows").insert({ start_time: "10:00", end_time: "09:00", active: false })).error?.code).toBe(CHECK);
    const { data, error } = await owner.from("booking_windows").insert({ start_time: "12:00", end_time: "13:00", active: false, sort_order: 999 }).select("id").single();
    expect(error).toBeNull();
    windows.push(data!.id);
    expect((await owner.from("booking_windows").delete().eq("id", data!.id)).error).toBeNull();
  });
});

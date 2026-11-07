// T1 access tests (DATA_MODEL §5, SECURITY §3): anon gets nothing; the owner gets only what §5 lists.
// Every "denied" check is paired with a service-role call that succeeds, so a missing object
// can't pass as "access denied".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, anonClient, Created, ownerClient, randomFarMonday, serviceClient } from "./booking-helpers";

const TABLES = [
  "booking_settings",
  "booking_services",
  "booking_weekly_hours",
  "booking_windows",
  "booking_date_overrides",
  "booking_public_holidays",
  "bookings",
  "booking_items",
  "booking_events",
  "sms_outbox",
] as const;

const FUNCTIONS: Record<string, Record<string, unknown>> = {
  booking_day: { d: "2031-01-06" },
  booking_availability: { p_from: "2031-01-06", p_to: "2031-01-07", p_online: true },
  booking_availability_at: { p_from: "2031-01-06", p_to: "2031-01-07", p_online: true, p_now: "2031-01-01T00:00:00Z" },
};

const PERMISSION_DENIED = "42501";

const service = serviceClient();
const anon = anonClient();
let owner: SupabaseClient;
const created = new Created(service);
let bookingId: string;
let eventId: string | undefined;

beforeAll(async () => {
  owner = await ownerClient();
  bookingId = await created.booking(addDays(randomFarMonday(), 2));
});
afterAll(async () => {
  await created.cleanup();
  if (eventId) {
    const { data } = await service.from("booking_events").select("id").eq("id", eventId);
    expect(data, "booking delete should cascade to its events").toEqual([]);
  }
});

describe("anon (public anon key)", () => {
  it.each(TABLES)("cannot select from %s", async (table) => {
    expect((await service.from(table).select("*").limit(1)).error).toBeNull();
    const { error } = await anon.from(table).select("*").limit(1);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it.each(TABLES)("cannot insert into %s", async (table) => {
    const { error } = await anon.from(table).insert({});
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("cannot update or delete bookings", async () => {
    expect((await anon.from("bookings").update({ is_read: true }).eq("id", bookingId)).error?.code).toBe(PERMISSION_DENIED);
    expect((await anon.from("bookings").delete().eq("id", bookingId)).error?.code).toBe(PERMISSION_DENIED);
  });

  it.each(Object.keys(FUNCTIONS))("cannot call %s", async (fn) => {
    expect((await service.rpc(fn, FUNCTIONS[fn])).error).toBeNull();
    const { error } = await anon.rpc(fn, FUNCTIONS[fn]);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

// T2: objects nobody but the server may touch
describe("server-only objects (T2)", () => {
  it("booking_tokens: anon and owner get nothing; service role can read", async () => {
    expect((await service.from("booking_tokens").select("*").limit(1)).error).toBeNull();
    for (const c of [anon, owner]) {
      expect((await c.from("booking_tokens").select("*").limit(1)).error?.code).toBe(PERMISSION_DENIED);
      expect((await c.from("booking_tokens").insert({})).error?.code).toBe(PERMISSION_DENIED);
    }
  });

  it("booking_create: anon and owner can't call it; the service role can", async () => {
    // Invalid input on purpose: proves the function exists without creating a booking
    const args = { p: {}, p_source: "online", p_allow_over: false };
    expect((await service.rpc("booking_create", args)).error?.message).toBe("VALIDATION");
    expect((await anon.rpc("booking_create", args)).error?.code).toBe(PERMISSION_DENIED);
    expect((await owner.rpc("booking_create", args)).error?.code).toBe(PERMISSION_DENIED);
  });

  it("booking_public_info: anon and owner can't call it; the service role can", async () => {
    expect((await service.rpc("booking_public_info")).error).toBeNull();
    expect((await anon.rpc("booking_public_info")).error?.code).toBe(PERMISSION_DENIED);
    expect((await owner.rpc("booking_public_info")).error?.code).toBe(PERMISSION_DENIED);
  });
});

// T3: SMS dispatch / cron functions are for the server only
describe("SMS and cron functions (T3)", () => {
  const calls: [string, Record<string, unknown>][] = [
    ["booking_sms_claim", { p_limit: 0, p_ids: [] }],
    ["booking_sms_result", { p_id: "00000000-0000-0000-0000-000000000000", p_ok: true, p_provider_id: null, p_error: null, p_retryable: true }],
    ["booking_enqueue_reminders_at", { p_now: "2020-01-01T00:00:00Z" }],
    ["booking_enqueue_reminders", {}],
    ["booking_retention", {}],
  ];
  it.each(calls)("%s: service role only", async (fn, args) => {
    expect((await service.rpc(fn, args)).error).toBeNull();
    expect((await anon.rpc(fn, args)).error?.code).toBe(PERMISSION_DENIED);
    expect((await owner.rpc(fn, args)).error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("service_role", () => {
  it("booking_events is append-only (insert, no update/delete); deleting the booking still cascades", async () => {
    const { data: ev, error } = await service
      .from("booking_events").insert({ booking_id: bookingId, actor: "system", action: "created" }).select("id").single();
    expect(error).toBeNull();
    expect((await service.from("booking_events").update({ action: "cancelled" }).eq("id", ev!.id)).error?.code).toBe(PERMISSION_DENIED);
    expect((await service.from("booking_events").delete().eq("id", ev!.id)).error?.code).toBe(PERMISSION_DENIED);
    // afterAll deletes the booking; the cascade must remove this event (checked below)
    eventId = ev!.id;
  });
});

describe("owner (authenticated)", () => {
  it.each(TABLES)("can select from %s", async (table) => {
    const { error } = await owner.from(table).select("*").limit(1);
    expect(error).toBeNull();
  });

  it("can see bookings (RLS allows the owner)", async () => {
    const { data } = await owner.from("bookings").select("id").eq("id", bookingId);
    expect(data).toEqual([{ id: bookingId }]);
  });

  it("can update only owner_notes and is_read on bookings", async () => {
    const ok = await owner.from("bookings").update({ is_read: true, owner_notes: "Test note" }).eq("id", bookingId).select("is_read");
    expect(ok.error).toBeNull();
    expect(ok.data).toEqual([{ is_read: true }]);

    for (const patch of [{ status: "cancelled" }, { drop_off_date: "2031-01-01" }, { over_capacity: true }, { mobile: "+61400000000" }]) {
      const { error } = await owner.from("bookings").update(patch).eq("id", bookingId);
      expect(error?.code, JSON.stringify(patch)).toBe(PERMISSION_DENIED);
    }
  });

  it("cannot insert or delete bookings directly (functions only)", async () => {
    expect((await owner.from("bookings").insert({})).error?.code).toBe(PERMISSION_DENIED);
    expect((await owner.from("bookings").delete().eq("id", bookingId)).error?.code).toBe(PERMISSION_DENIED);
    expect((await owner.from("booking_items").insert({})).error?.code).toBe(PERMISSION_DENIED);
    expect((await owner.from("booking_events").insert({})).error?.code).toBe(PERMISSION_DENIED);
    expect((await owner.from("sms_outbox").insert({})).error?.code).toBe(PERMISSION_DENIED);
  });

  it("cannot delete services (deactivate instead) or public holidays", async () => {
    expect((await owner.from("booking_services").delete().eq("name", "__none__")).error?.code).toBe(PERMISSION_DENIED);
    expect((await owner.from("booking_public_holidays").delete().eq("date", "1900-01-01")).error?.code).toBe(PERMISSION_DENIED);
  });

  it("can update booking settings (no-op update)", async () => {
    const { data } = await owner.from("booking_settings").select("horizon_days").single();
    const { error } = await owner.from("booking_settings").update({ horizon_days: data!.horizon_days }).eq("id", 1);
    expect(error).toBeNull();
  });

  it("can manage date overrides", async () => {
    const d = randomFarMonday();
    expect((await owner.from("booking_date_overrides").insert({ date: d, is_open: false, reason: "T1 access test", show_phone: true })).error).toBeNull();
    expect((await owner.from("booking_date_overrides").delete().eq("date", d)).error).toBeNull();
  });

  it("can call booking_availability but not the internal functions", async () => {
    expect((await owner.rpc("booking_availability", FUNCTIONS.booking_availability)).error).toBeNull();
    expect((await owner.rpc("booking_day", FUNCTIONS.booking_day)).error?.code).toBe(PERMISSION_DENIED);
    expect((await owner.rpc("booking_availability_at", FUNCTIONS.booking_availability_at)).error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("owner actions (T4–T6)", () => {
  const zero = "00000000-0000-0000-0000-000000000000";
  const calls: [string, Record<string, unknown>][] = [
    ["booking_owner_set_status", { p_id: zero, p_status: "arrived" }],
    ["booking_owner_cancel", { p_id: zero, p_notify: false }],
    ["booking_owner_reschedule", { p_id: zero, p_date: "2031-01-07", p_window_id: zero, p_allow_over: false, p_notify: false }],
    ["booking_link_checkin", { p_id: zero, p_checkin_id: null }],
    ["booking_retry_sms", { p_outbox_id: zero }],
    ["booking_owner_create", { p: {}, p_allow_over: false, p_send_sms: false }],
    ["booking_customer_lookup", { p_mobile: "x" }],
    ["booking_send_link", { p_mobile: "x" }],
    ["booking_send_ready_sms", { p_id: zero, p_resend: false }],
    ["booking_checkin_ready_sms", { p_checkin_id: zero, p_resend: false }],
  ];
  // The owner reaches the function (it answers NOT_FOUND / VALIDATION for the zero id); anon and
  // the server's service role can't call it at all.
  it.each(calls)("%s: owner only", async (fn, args) => {
    const { error } = await owner.rpc(fn, args);
    expect(error?.code).toBe("P0001");
    expect(["NOT_FOUND", "VALIDATION"]).toContain(error?.message);
    expect((await anon.rpc(fn, args)).error?.code).toBe(PERMISSION_DENIED);
    expect((await service.rpc(fn, args)).error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("test fault switch (T6)", () => {
  it("only the server key can read or write booking_test_faults", async () => {
    expect((await service.from("booking_test_faults").select("name")).error).toBeNull();
    for (const c of [anon, owner]) {
      expect((await c.from("booking_test_faults").select("name")).error?.code).toBe(PERMISSION_DENIED);
      expect((await c.from("booking_test_faults").insert({ name: "checkin_link" })).error?.code).toBe(PERMISSION_DENIED);
    }
  });

  const zero = "00000000-0000-0000-0000-000000000000";
  it.each([
    ["booking_fault", { p_name: "checkin_link" }],
    ["booking_format_time", { t: "17:00" }],
    ["booking_queue_ready", { p_booking_id: zero, p_checkin_id: null, p_mobile: "+61400000000", p_first: "x", p_rego: "x", p_resend: false }],
  ] as const)("internal %s: nobody can call it", async (fn, args) => {
    for (const c of [anon, owner, service]) expect((await c.rpc(fn, args)).error?.code).toBe(PERMISSION_DENIED);
  });
});

// T7: the manage link functions are for the server's route handlers only
describe("manage link functions (T7)", () => {
  const zero = "00000000-0000-0000-0000-000000000000";
  const token = "A".repeat(43);
  it.each([
    ["booking_by_token", { p_token: token }],
    ["booking_cancel_by_token", { p_token: token }],
    ["booking_reschedule_by_token", { p_token: token, p_date: "2031-01-07", p_window_id: zero }],
  ] as const)("%s: service role only (anon and owner refused)", async (fn, args) => {
    expect((await service.rpc(fn, args)).error?.message).toBe("NOT_FOUND"); // reachable, unknown token
    expect((await anon.rpc(fn, args)).error?.code).toBe(PERMISSION_DENIED);
    expect((await owner.rpc(fn, args)).error?.code).toBe(PERMISSION_DENIED);
  });

  it.each([
    ["booking_change_until", { d: "2031-01-07" }],
    ["booking_can_change", { p_status: "booked", d: "2031-01-07" }],
    ["booking_token_booking", { p_token: token }],
    ["booking_manage_view", { p_id: zero }],
    ["booking_cancel_core", { p_id: zero, p_actor: "customer", p_notify: true }],
    ["booking_reschedule_core", { p_id: zero, p_date: "2031-01-07", p_window_id: zero, p_online: true, p_allow_over: false, p_notify: true, p_actor: "customer" }],
  ] as const)("internal %s: nobody can call it", async (fn, args) => {
    for (const c of [anon, owner, service]) expect((await c.rpc(fn, args)).error?.code).toBe(PERMISSION_DENIED);
  });
});

// T8: listing a day's bookings before closing it — the owner only
describe("booking_on_date (T8)", () => {
  it("owner can call it; anon can't", async () => {
    expect((await owner.rpc("booking_on_date", { p_date: "2031-01-07" })).error).toBeNull();
    expect((await anon.rpc("booking_on_date", { p_date: "2031-01-07" })).error?.code).toBe(PERMISSION_DENIED);
  });
});

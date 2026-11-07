// T3: SMS outbox claim/result, reminders, retention (BUSINESS_RULES §10, §14; DATA_MODEL sms_outbox).
// booking_sms_claim takes an optional id list so these tests only ever touch their own rows.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { addDays, bookingIds, create, Created, randomFarMonday, serviceClient, sydney, validInput } from "./booking-helpers";

const db = serviceClient();
const created = new Created(db);
let serviceId: string;
let windowId: string;

beforeAll(async () => {
  const ids = await bookingIds(db);
  serviceId = ids.services[0].id;
  windowId = ids.windowId;
});
afterEach(() => created.cleanup());
afterAll(() => created.cleanup());

type Claimed = { id: string; template: string; to_mobile: string; body: string; token: string | null; sender_id: string; attempts: number };

async function claim(ids: string[], limit = 50): Promise<Claimed[]> {
  const { data, error } = await db.rpc("booking_sms_claim", { p_limit: limit, p_ids: ids });
  if (error) throw new Error(`claim: ${error.code} ${error.message}`);
  return data as Claimed[];
}

async function result(id: string, ok: boolean, opts: { providerId?: string; error?: string; retryable?: boolean } = {}) {
  const { data, error } = await db.rpc("booking_sms_result", {
    p_id: id, p_ok: ok, p_provider_id: opts.providerId ?? null, p_error: opts.error ?? null, p_retryable: opts.retryable ?? true,
  });
  if (error) throw new Error(`result: ${error.code} ${error.message}`);
  return data as string | null;
}

async function row(id: string) {
  const { data } = await db.from("sms_outbox").select("*").eq("id", id).single();
  return data!;
}

/** A real booking (owner source, far date) with its queued confirmation. */
async function bookingWithConfirmation(date = addDays(randomFarMonday(), 1)) {
  const r = await create(db, validInput({ serviceId, windowId, date }), "owner");
  if (!r.ok) throw new Error(`create: ${r.code}`);
  created.track(r.data.id);
  const { data: sms } = await db.from("sms_outbox").select("id").eq("booking_id", r.data.id).eq("template", "confirmation").single();
  return { ...r.data, smsId: sms!.id as string };
}

describe("claim", () => {
  it("claims a due row once: status sending, attempts 1, with the token and sender ID", async () => {
    const b = await bookingWithConfirmation();
    const [c, ...rest] = await claim([b.smsId]);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ id: b.smsId, template: "confirmation", token: b.token, sender_id: "SaiMotor", attempts: 1 });
    expect(c.body).toContain("{manage_link}");
    expect(await row(b.smsId)).toMatchObject({ status: "sending", attempts: 1 });
    expect(await claim([b.smsId])).toEqual([]); // already claimed
  });

  it("parallel claims never hand out the same row twice (skip locked)", async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, () => created.sms({ template: "booking_link", body: "Book here" })));
    const [a, b] = await Promise.all([claim(ids, 6), claim(ids, 6)]);
    const all = [...a, ...b].map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual([...ids].sort());
  });

  it("doesn't claim rows that aren't due yet", async () => {
    const id = await created.sms({ template: "booking_link", body: "x", next_attempt_at: new Date(Date.now() + 60_000).toISOString() });
    expect(await claim([id])).toEqual([]);
  });

  it("re-queues a row stuck in 'sending' for more than 10 minutes", async () => {
    const id = await created.sms({ template: "booking_link", body: "x", status: "sending", attempts: 1,
      claimed_at: new Date(Date.now() - 11 * 60_000).toISOString() });
    const [c] = await claim([id]);
    expect(c).toMatchObject({ id, attempts: 2 });
  });
});

describe("stale rows are cancelled, not sent", () => {
  it("confirmation for a cancelled booking", async () => {
    const b = await bookingWithConfirmation();
    await db.from("bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", b.id);
    expect(await claim([b.smsId])).toEqual([]);
    expect(await row(b.smsId)).toMatchObject({ status: "cancelled", last_error: "Booking is no longer booked" });
  });

  it("reminder for a cancelled booking", async () => {
    const b = await bookingWithConfirmation();
    const id = await created.sms({ booking_id: b.id, template: "reminder", body: "R {manage_link}" });
    await db.from("bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", b.id);
    expect(await claim([id])).toEqual([]);
    expect((await row(id)).status).toBe("cancelled");
  });

  it("a link SMS whose token has expired", async () => {
    const b = await bookingWithConfirmation();
    await db.from("booking_tokens").delete().eq("booking_id", b.id);
    expect(await claim([b.smsId])).toEqual([]);
    expect(await row(b.smsId)).toMatchObject({ status: "cancelled", last_error: "Manage link has expired" });
  });
});

describe("result + retries (3 tries: retry after 1 min, then 5 min, then failed)", () => {
  it("success: sent, with provider id and time", async () => {
    const b = await bookingWithConfirmation();
    await claim([b.smsId]);
    expect(await result(b.smsId, true, { providerId: "CS-123" })).toBe("sent");
    const r = await row(b.smsId);
    expect(r).toMatchObject({ status: "sent", provider_message_id: "CS-123", last_error: null });
    expect(r.sent_at).not.toBeNull();
    expect(await result(b.smsId, true)).toBeNull(); // only rows in 'sending' take a result
  });

  it("retryable failures back off, then fail after the 3rd try", async () => {
    const id = await created.sms({ template: "booking_link", body: "x" });
    const due = () => db.from("sms_outbox").update({ next_attempt_at: new Date().toISOString() }).eq("id", id);

    await claim([id]);
    const t0 = Date.now();
    expect(await result(id, false, { error: "HTTP 503" })).toBe("pending");
    let r = await row(id);
    expect(r).toMatchObject({ attempts: 1, last_error: "HTTP 503" });
    expect(Date.parse(r.next_attempt_at) - t0).toBeGreaterThan(50_000);
    expect(Date.parse(r.next_attempt_at) - t0).toBeLessThan(70_000);

    await due();
    await claim([id]);
    expect(await result(id, false, { error: "timeout" })).toBe("pending");
    r = await row(id);
    expect(r.attempts).toBe(2);
    expect(Date.parse(r.next_attempt_at) - Date.now()).toBeGreaterThan(4 * 60_000);

    await due();
    await claim([id]);
    expect(await result(id, false, { error: "HTTP 500" })).toBe("failed");
    expect(await row(id)).toMatchObject({ status: "failed", attempts: 3, last_error: "HTTP 500" });
    await due();
    expect(await claim([id])).toEqual([]);
  });

  it("a non-retryable failure fails at once; errors are capped at 300 chars", async () => {
    const id = await created.sms({ template: "booking_link", body: "x" });
    await claim([id]);
    expect(await result(id, false, { error: "INVALID_RECIPIENT ".repeat(40), retryable: false })).toBe("failed");
    const r = await row(id);
    expect(r).toMatchObject({ status: "failed", attempts: 1 });
    expect(r.last_error.length).toBeLessThanOrEqual(300);
  });
});

describe("reminders (10:00 Sydney the day before)", () => {
  async function remind(now: string): Promise<number> {
    const { data, error } = await db.rpc("booking_enqueue_reminders_at", { p_now: now });
    if (error) throw new Error(`reminders: ${error.code} ${error.message}`);
    return data as number;
  }
  const reminders = async (bookingId: string) =>
    (await db.from("sms_outbox").select("id, body, dedupe_key, status").eq("booking_id", bookingId).eq("template", "reminder")).data!;

  it("queues one reminder for a booked booking tomorrow, from 10:00, never twice", async () => {
    const d = addDays(randomFarMonday(), 1); // Tuesday
    const b = await bookingWithConfirmation(d);
    const dayBefore = addDays(d, -1);

    await remind(sydney(dayBefore, "09:59"));
    expect(await reminders(b.id)).toEqual([]);

    await remind(sydney(dayBefore, "10:00"));
    await remind(sydney(dayBefore, "10:15"));
    const rs = await reminders(b.id);
    expect(rs).toHaveLength(1);
    expect(rs[0].dedupe_key).toBe(`${b.id}:reminder:${d}`);
    expect(rs[0].body).toMatch(/^Reminder: T[A-Z0-9]+ is booked at Sai Motor Works tomorrow, drop off 8:30–9:30am\./);
    expect(rs[0].body).toMatch(/Manage: \{manage_link\}$/);
    expect(rs[0].body).not.toContain(b.token);
  });

  it("no reminder for a booking made after 10:00 the day before, or a cancelled one", async () => {
    const d = addDays(randomFarMonday(), 1);
    const late = await bookingWithConfirmation(d);
    await db.from("bookings").update({ created_at: sydney(addDays(d, -1), "10:05") }).eq("id", late.id);
    const gone = await bookingWithConfirmation(d);
    await db.from("bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", gone.id);

    await remind(sydney(addDays(d, -1), "16:00"));
    expect(await reminders(late.id)).toEqual([]);
    expect(await reminders(gone.id)).toEqual([]);
  });

  // DST ends Sun 4 Apr 2027 (03:00 AEDT → 02:00 AEST): 10:00 that Sunday is 00:00 UTC.
  // Code assuming +11 would already send at 23:30 UTC the day before.
  it("uses Sydney time on the day DST ends", async () => {
    const b = await bookingWithConfirmation("2027-04-05");
    await remind("2027-04-03T23:30:00Z"); // 09:30 AEST
    expect(await reminders(b.id)).toEqual([]);
    await remind("2027-04-04T00:00:00Z"); // 10:00 AEST
    expect(await reminders(b.id)).toHaveLength(1);
  });

  it("a reminder that is still pending after its day has started is cancelled by claim", async () => {
    const d = addDays(randomFarMonday(), 1);
    const b = await bookingWithConfirmation(d);
    const id = await created.sms({ booking_id: b.id, template: "reminder", body: "R {manage_link}" });
    // Real "today" is long before d, so this one is still fine…
    expect((await claim([id])).map((c) => c.id)).toEqual([id]);
    // …but one for a day that has already come is stale
    const past = await created.sms({ booking_id: b.id, template: "reminder", body: "R", dedupe_key: `test:${crypto.randomUUID()}` });
    await db.from("bookings").update({ drop_off_date: "2026-01-05" }).eq("id", b.id);
    expect(await claim([past])).toEqual([]);
    expect(await row(past)).toMatchObject({ status: "cancelled", last_error: "Reminder is too late" });
  });
});

describe("retention", () => {
  it("deletes outbox rows older than 2 years and expired tokens, keeps the rest", async () => {
    const old = await created.sms({ template: "booking_link", body: "old", status: "sent",
      created_at: new Date(Date.now() - (2 * 365 + 2) * 86_400_000).toISOString() });
    const recent = await created.sms({ template: "booking_link", body: "new", status: "sent" });
    const b = await bookingWithConfirmation();
    const expired = await bookingWithConfirmation();
    // service_role can't update booking_tokens (select/insert/delete only), so swap the row for an expired one
    expect((await db.from("booking_tokens").delete().eq("booking_id", expired.id)).error).toBeNull();
    expect((await db.from("booking_tokens").insert({ booking_id: expired.id, token: expired.token, expires_on: "2020-01-01" })).error)
      .toBeNull();

    const { data, error } = await db.rpc("booking_retention");
    expect(error).toBeNull();
    expect(data.outbox_deleted).toBeGreaterThanOrEqual(1);
    expect(data.tokens_deleted).toBeGreaterThanOrEqual(1);

    expect((await db.from("sms_outbox").select("id").in("id", [old, recent])).data!.map((r) => r.id)).toEqual([recent]);
    expect((await db.from("booking_tokens").select("booking_id").in("booking_id", [b.id, expired.id])).data!.map((r) => r.booking_id))
      .toEqual([b.id]);
  });
});

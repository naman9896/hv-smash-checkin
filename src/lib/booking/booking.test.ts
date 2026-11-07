import { describe, expect, it } from "vitest";
import { errorResponseFor, ERRORS } from "./errors";
import { formatDay, formatPrice, formatWindow } from "./format";
import { AvailabilityQuery, normaliseMobile, normaliseRego, PublicCreateBooking, toDbInput } from "./schemas";

const valid = {
  serviceIds: ["7b0f1f8e-2d1a-4c3e-9f00-000000000001"],
  date: "2026-11-12",
  windowId: "7b0f1f8e-2d1a-4c3e-9f00-000000000002",
  customer: { firstName: "Sam", lastName: "Lee", mobile: "0412 345 678", email: "" },
  vehicle: { rego: "abc-123", state: "NSW", make: "Toyota", model: "Corolla", year: "" },
  notes: "",
};

describe("normalising", () => {
  it.each([
    ["0412 345 678", "+61412345678"],
    ["+61 412 345 678", "+61412345678"],
    ["61412345678", "+61412345678"],
    ["(04) 1234-5678", "+61412345678"],
    ["02 4932 1234", null],
    ["1300 017 205", null],
    ["0412 345 67", null],
  ])("mobile %s → %s", (raw, out) => expect(normaliseMobile(raw)).toBe(out));

  it("rego: uppercase, letters and digits only", () => {
    expect(normaliseRego(" ab c-1.2 ")).toBe("ABC12");
  });
});

describe("PublicCreateBooking", () => {
  it("accepts a valid booking and normalises it", () => {
    const r = PublicCreateBooking.parse(valid);
    expect(r.customer.mobile).toBe("+61412345678");
    expect(r.vehicle.rego).toBe("ABC123");
    expect(r.customer.email).toBeUndefined();
    expect(r.vehicle.year).toBeUndefined();
  });

  it("rejects unknown fields at every level (.strict())", () => {
    expect(PublicCreateBooking.safeParse({ ...valid, isAdmin: true }).success).toBe(false);
    expect(PublicCreateBooking.safeParse({ ...valid, customer: { ...valid.customer, role: "owner" } }).success).toBe(false);
    expect(PublicCreateBooking.safeParse({ ...valid, vehicle: { ...valid.vehicle, vin: "x" } }).success).toBe(false);
  });

  it.each([
    ["no services", { serviceIds: [] }],
    ["6 services", { serviceIds: Array.from({ length: 6 }, (_, i) => `7b0f1f8e-2d1a-4c3e-9f00-00000000001${i}`) }],
    ["a repeated service", { serviceIds: [valid.serviceIds[0], valid.serviceIds[0]] }],
    ["a bad date", { date: "12/11/2026" }],
    ["an impossible date", { date: "2026-02-30" }],
    ["a landline", { customer: { ...valid.customer, mobile: "02 4932 1234" } }],
    ["a bad email", { customer: { ...valid.customer, email: "nope" } }],
    ["a long rego", { vehicle: { ...valid.vehicle, rego: "ABCDEFGHIJ" } }],
    ["a bad state", { vehicle: { ...valid.vehicle, state: "XX" } }],
    ["a bad year", { vehicle: { ...valid.vehicle, year: "1800" } }],
    ["long notes", { notes: "x".repeat(1001) }],
    ["an empty name", { customer: { ...valid.customer, firstName: "  " } }],
  ])("rejects %s", (_label, over) => {
    expect(PublicCreateBooking.safeParse({ ...valid, ...over }).success).toBe(false);
  });

  it("maps to the DB shape (snake_case, no extra keys)", () => {
    expect(toDbInput(PublicCreateBooking.parse({ ...valid, vehicle: { ...valid.vehicle, year: "2015" }, notes: " hi " }))).toEqual({
      service_ids: valid.serviceIds,
      date: "2026-11-12",
      window_id: valid.windowId,
      first_name: "Sam",
      last_name: "Lee",
      mobile: "+61412345678",
      email: null,
      rego: "ABC123",
      rego_state: "NSW",
      make: "Toyota",
      model: "Corolla",
      year: 2015,
      notes: "hi",
    });
  });
});

describe("AvailabilityQuery", () => {
  it("accepts up to 31 days", () => {
    expect(AvailabilityQuery.safeParse({ from: "2026-11-01", to: "2026-12-01" }).success).toBe(true);
  });
  it.each([
    [{ from: "2026-11-01", to: "2026-12-02" }],
    [{ from: "2026-11-10", to: "2026-11-01" }],
    [{ from: "2026-11-01" }],
    [{ from: "2026-11-01", to: "2026-11-02", extra: "1" }],
  ])("rejects %j", (q) => expect(AvailabilityQuery.safeParse(q).success).toBe(false));
});

describe("errors", () => {
  it("maps every DB code to the API status", () => {
    expect(Object.fromEntries(Object.entries(ERRORS).map(([k, v]) => [k, v.status]))).toEqual({
      VALIDATION: 400, NOT_FOUND: 404, FULL: 409, DUPLICATE_BOOKING: 409, CLOSED: 422, CUTOFF_PASSED: 422,
      OUTSIDE_HORIZON: 422, MOBILE_LIMIT: 422, INVALID_TRANSITION: 422, RATE_LIMITED: 429, BOOKING_OFF: 503,
    });
  });

  it("unknown DB errors become a generic 500 with no details", async () => {
    const res = errorResponseFor({ code: "23505", message: "duplicate key value violates unique constraint", details: "Key (mobile)=(+61412345678)" });
    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).not.toMatch(/mobile|61412|constraint/);
  });

  it("DUPLICATE_BOOKING names the existing date", async () => {
    const res = errorResponseFor({ code: "P0001", message: "DUPLICATE_BOOKING", details: "2026-11-12" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({ code: "DUPLICATE_BOOKING", message: expect.stringContaining("Thu 12 Nov") });
  });
});

describe("format", () => {
  it("windows", () => {
    expect(formatWindow("08:30:00", "09:30:00")).toBe("8:30–9:30am");
    expect(formatWindow("11:30", "12:30")).toBe("11:30am–12:30pm");
    expect(formatWindow("13:00", "14:00")).toBe("1:00–2:00pm");
  });
  it("days", () => {
    expect(formatDay("2026-11-12")).toBe("Thu 12 Nov");
    expect(formatDay("2027-04-04")).toBe("Sun 4 Apr");
  });
  it("prices", () => {
    expect(formatPrice("from", 16000)).toBe("From $160");
    expect(formatPrice("fixed", 9950)).toBe("$99.50");
    expect(formatPrice("quote", null)).toBe("Price on inspection");
  });
});

describe("dates", async () => {
  const { addDaysIso, sydneyToday } = await import("./dates");
  it("today in Sydney, not UTC", () => {
    expect(sydneyToday(new Date("2026-10-03T14:30:00Z"))).toBe("2026-10-04"); // 00:30 Sun AEST
    expect(sydneyToday(new Date("2026-10-03T13:30:00Z"))).toBe("2026-10-03"); // 23:30 Sat AEST
  });
  it("adds calendar days across DST", () => {
    expect(addDaysIso("2027-04-03", 2)).toBe("2027-04-05");
    expect(addDaysIso("2026-10-31", 1)).toBe("2026-11-01");
  });
});

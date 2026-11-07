import { describe, expect, it } from "vitest";
import { formatChangeUntil, isManageToken, manageErrorMessage, toManageView } from "./manage";
import { Reschedule } from "./schemas";

describe("isManageToken", () => {
  it("accepts a 43-char base64url token only", () => {
    expect(isManageToken("a".repeat(43))).toBe(true);
    expect(isManageToken("Ab9_-".repeat(8) + "xyz")).toBe(true);
    for (const t of ["a".repeat(42), "a".repeat(44), `${"a".repeat(42)}+`, `${"a".repeat(42)}/`, `${"a".repeat(42)}=`, "", "../etc"]) {
      expect(isManageToken(t)).toBe(false);
    }
  });
});

describe("Reschedule schema", () => {
  const ok = { date: "2026-11-20", windowId: "7b0f1f8e-2d1a-4c3e-9f00-000000000002" };
  it("takes a date and a window id, nothing else", () => {
    expect(Reschedule.safeParse(ok).success).toBe(true);
    expect(Reschedule.safeParse({ ...ok, status: "cancelled" }).success).toBe(false);
    expect(Reschedule.safeParse({ ...ok, date: "2026-02-30" }).success).toBe(false);
    expect(Reschedule.safeParse({ ...ok, windowId: "x" }).success).toBe(false);
    expect(Reschedule.safeParse({ date: ok.date }).success).toBe(false);
  });
});

describe("toManageView", () => {
  it("maps the DB view to exactly the API_SPEC fields", () => {
    const v = toManageView({
      reference_no: "BK-1042", first_name: "Ada", rego: "ABC123", make: "Toyota", model: "Corolla", services: ["Logbook service"],
      date: "2026-11-20", window_start: "08:30", window_end: "09:30", status: "booked", can_change: true,
      change_until: "2026-11-19T17:00", phone: "1300 017 205",
    });
    expect(v).toEqual({
      referenceNo: "BK-1042", firstName: "Ada", rego: "ABC123", make: "Toyota", model: "Corolla", services: ["Logbook service"],
      date: "2026-11-20", window: { start: "08:30", end: "09:30" }, status: "booked", canChange: true,
      changeUntil: "2026-11-19T17:00", business: { phone: "1300 017 205" },
    });
  });
});

describe("messages", () => {
  it("formatChangeUntil: '5pm Thursday 19 November'", () => {
    expect(formatChangeUntil("2026-11-19T17:00")).toBe("5pm Thursday 19 November");
    expect(formatChangeUntil("2026-11-19T16:30")).toBe("4:30pm Thursday 19 November");
  });

  it("manage errors read for a customer holding a link", () => {
    expect(manageErrorMessage("NOT_FOUND", null)).toMatch(/link isn't valid/);
    expect(manageErrorMessage("CUTOFF_PASSED", "booking")).toMatch(/too late to change this booking online/);
    expect(manageErrorMessage("CUTOFF_PASSED", "date")).toBeUndefined(); // the normal "too late to book that day"
    expect(manageErrorMessage("INVALID_TRANSITION", "unchanged")).toMatch(/already your drop-off day/);
    expect(manageErrorMessage("INVALID_TRANSITION", "cancelled>cancelled")).toMatch(/can't be changed/);
    expect(manageErrorMessage("FULL", null)).toBeUndefined();
  });
});

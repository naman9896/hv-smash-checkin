import { describe, expect, it } from "vitest";
import { isNotArrived, ownerErrorMessage, smsSummary, statusActions, sydneyNow } from "./owner";

describe("statusActions (mirrors booking_owner_set_status)", () => {
  const today = "2026-11-10";
  it.each([
    ["booked", "2026-11-12", ["arrived"]], // no-show only on/after the day
    ["booked", today, ["arrived", "no_show"]],
    ["booked", "2026-11-01", ["arrived", "no_show"]],
    ["arrived", today, ["completed", "booked"]],
    ["completed", today, ["arrived"]],
    ["no_show", today, ["booked"]],
    ["cancelled", today, ["booked"]],
  ] as const)("%s on %s → %j", (status, date, to) => {
    expect(statusActions(status, date, today).map((a) => a.to)).toEqual(to);
  });

  it("marks undo actions", () => {
    expect(statusActions("arrived", today, today)).toEqual([
      { to: "completed", label: "Mark completed", undo: false },
      { to: "booked", label: "Undo arrived", undo: true },
    ]);
  });
});

describe("isNotArrived", () => {
  const b = (status: "booked" | "arrived", drop_off_date: string) => ({ status, drop_off_date });
  it("booked and past 17:00 on the day, or any earlier day", () => {
    expect(isNotArrived(b("booked", "2026-11-10"), { date: "2026-11-10", time: "16:59" })).toBe(false);
    expect(isNotArrived(b("booked", "2026-11-10"), { date: "2026-11-10", time: "17:00" })).toBe(true);
    expect(isNotArrived(b("booked", "2026-11-09"), { date: "2026-11-10", time: "08:00" })).toBe(true);
    expect(isNotArrived(b("booked", "2026-11-11"), { date: "2026-11-10", time: "23:00" })).toBe(false);
    expect(isNotArrived(b("arrived", "2026-11-09"), { date: "2026-11-10", time: "18:00" })).toBe(false);
  });
});

describe("sydneyNow", () => {
  it("uses Sydney time across DST (AEDT +11 in November)", () => {
    expect(sydneyNow(new Date("2026-11-10T06:00:00Z"))).toEqual({ date: "2026-11-10", time: "17:00" });
    expect(sydneyNow(new Date("2026-11-09T13:30:00Z"))).toEqual({ date: "2026-11-10", time: "00:30" });
    expect(sydneyNow(new Date("2027-06-10T07:00:00Z"))).toEqual({ date: "2027-06-10", time: "17:00" }); // AEST +10
  });
});

describe("smsSummary", () => {
  it("failed wins, then queued, then sent", () => {
    expect(smsSummary([])).toBe("none");
    expect(smsSummary([{ status: "cancelled" }])).toBe("none");
    expect(smsSummary([{ status: "sent" }])).toBe("sent");
    expect(smsSummary([{ status: "sent" }, { status: "pending" }])).toBe("queued");
    expect(smsSummary([{ status: "sent" }, { status: "sending" }, { status: "failed" }])).toBe("failed");
  });
});

describe("ownerErrorMessage", () => {
  const e = (message: string, details: string | null = null) => ({ code: "P0001", message, details });
  it("words each DB code for the owner", () => {
    expect(ownerErrorMessage(e("FULL"))).toMatch(/Overbook/);
    expect(ownerErrorMessage(e("CLOSED", "past"))).toBe("That day has already passed.");
    expect(ownerErrorMessage(e("CLOSED", "holiday"))).toBe("The workshop is closed that day.");
    expect(ownerErrorMessage(e("DUPLICATE_BOOKING", "2026-11-12"))).toBe("This car already has a booking on Thu 12 Nov.");
    expect(ownerErrorMessage(e("INVALID_TRANSITION", "not_yet"))).toMatch(/on or after/);
    expect(ownerErrorMessage(e("VALIDATION", "checkin_id"))).toMatch(/already linked/);
    expect(ownerErrorMessage(e("NOT_FOUND", "checkin"))).toBe("That check-in no longer exists.");
    expect(ownerErrorMessage(e("RATE_LIMITED"))).toMatch(/5 booking links today/);
    expect(ownerErrorMessage(e("VALIDATION", "mobile"))).toMatch(/Australian mobile/);
    expect(ownerErrorMessage(e("VALIDATION", "sms_off"))).toMatch(/turned off/);
    expect(ownerErrorMessage(e("VALIDATION", "not_mobile"))).toBe("Not a mobile number.");
    expect(ownerErrorMessage(e("INVALID_TRANSITION", "already_sent"))).toMatch(/already been sent/);
  });
  it("never shows raw database errors", () => {
    expect(ownerErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "x"' })).toBe(
      "Something went wrong. Please try again.",
    );
    expect(ownerErrorMessage({ code: "P0001", message: "SOMETHING_ELSE" })).toBe("Something went wrong. Please try again.");
  });
});

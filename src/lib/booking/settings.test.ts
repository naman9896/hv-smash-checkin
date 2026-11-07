import { describe, expect, it } from "vitest";
import {
  GeneralSettings, OverrideForm, ServiceForm, WeeklyHoursRow, WindowForm, fieldErrors, hhmm,
} from "./settings";

const general = {
  online_enabled: true, horizon_days: "30", online_cutoff_time: "17:00", cancel_cutoff_time: "17:00", reminder_time: "10:00",
  pickup_message: "From 3pm", price_disclaimer: "Final price varies", sms_sender_id: "SaiMotor", sms_enabled: true,
  ready_sms_mode: "manual", max_active_per_mobile: "3",
};

describe("GeneralSettings", () => {
  it("accepts the defaults and coerces numbers", () => {
    const r = GeneralSettings.safeParse(general);
    expect(r.success && r.data).toMatchObject({ horizon_days: 30, max_active_per_mobile: 3 });
  });

  it.each(["Sai Motor", "SaiMotorWorks1", "Sai-Motor", "", "Sai!"])("sender ID %j → 'up to 11 letters and numbers'", (id) => {
    const r = GeneralSettings.safeParse({ ...general, sms_sender_id: id });
    expect(r.success).toBe(false);
    expect(fieldErrors(r.error!).sms_sender_id).toMatch(/Up to 11 letters and numbers/);
  });

  it("horizon 1–90, max per mobile 1–20, real times, no unknown fields", () => {
    expect(fieldErrors(GeneralSettings.safeParse({ ...general, horizon_days: "0" }).error!).horizon_days).toBeTruthy();
    expect(fieldErrors(GeneralSettings.safeParse({ ...general, horizon_days: "91" }).error!).horizon_days).toBeTruthy();
    expect(fieldErrors(GeneralSettings.safeParse({ ...general, max_active_per_mobile: "21" }).error!).max_active_per_mobile).toBeTruthy();
    expect(fieldErrors(GeneralSettings.safeParse({ ...general, reminder_time: "25:00" }).error!).reminder_time).toBeTruthy();
    expect(GeneralSettings.safeParse({ ...general, id: 2 }).success).toBe(false);
    expect(fieldErrors(GeneralSettings.safeParse({ ...general, pickup_message: "x".repeat(201) }).error!).pickup_message).toBeTruthy();
  });
});

describe("WeeklyHoursRow", () => {
  const row = { weekday: 7, is_open: true, open_time: "08:30", close_time: "16:00", capacity_cars: "6" };
  it("open < close", () => {
    const e = fieldErrors(WeeklyHoursRow.safeParse({ ...row, close_time: "08:30" }).error!);
    expect(e.close_time).toMatch(/after opening/);
  });
  it("an open day needs a capacity (else it shows full); a closed day doesn't", () => {
    expect(fieldErrors(WeeklyHoursRow.safeParse({ ...row, capacity_cars: "0" }).error!).capacity_cars).toMatch(/How many cars/);
    expect(fieldErrors(WeeklyHoursRow.safeParse({ ...row, capacity_cars: "" }).error!).capacity_cars).toMatch(/How many cars/);
    expect(WeeklyHoursRow.safeParse({ ...row, is_open: false, capacity_cars: "0" }).success).toBe(true);
  });
});

describe("ServiceForm", () => {
  const svc = { name: "Basic service", description: "", price_type: "from", price: "160", online_bookable: true, active: true };
  it("dollars → cents; quote → no price", () => {
    expect(ServiceForm.parse(svc)).toMatchObject({ price_type: "from", price_cents: 16000 });
    expect(ServiceForm.parse({ ...svc, price: "99.50", price_type: "fixed" }).price_cents).toBe(9950);
    expect(ServiceForm.parse({ ...svc, price_type: "quote", price: "120" }).price_cents).toBeNull();
  });
  it("fixed / from need a price; a name is required", () => {
    expect(fieldErrors(ServiceForm.safeParse({ ...svc, price: "" }).error!).price).toMatch(/Enter a price/);
    expect(fieldErrors(ServiceForm.safeParse({ ...svc, price: "12.345" }).error!).price).toBeTruthy();
    expect(fieldErrors(ServiceForm.safeParse({ ...svc, name: " " }).error!).name).toBeTruthy();
  });
});

describe("WindowForm", () => {
  it("start < end", () => {
    expect(WindowForm.safeParse({ start_time: "08:30", end_time: "09:30" }).success).toBe(true);
    expect(fieldErrors(WindowForm.safeParse({ start_time: "09:30", end_time: "09:30" }).error!).end_time).toMatch(/after/);
  });
});

describe("OverrideForm", () => {
  const closed = { date: "2026-12-24", is_open: false, open_time: "", close_time: "", capacity_cars: "", reason: "Christmas Eve", show_phone: true };
  it("closed: no hours or capacity saved; phone toggle allowed", () => {
    expect(OverrideForm.parse({ ...closed, capacity_cars: "4", open_time: "08:30" })).toEqual({
      date: "2026-12-24", is_open: false, open_time: null, close_time: null, capacity_cars: null, reason: "Christmas Eve", show_phone: true,
    });
  });
  it("open (e.g. a Sunday): capacity required; hours optional but in order; phone toggle off", () => {
    const open = { ...closed, is_open: true, show_phone: true, reason: "" };
    expect(fieldErrors(OverrideForm.safeParse(open).error!).capacity_cars).toMatch(/How many cars/);
    expect(OverrideForm.parse({ ...open, capacity_cars: "5" })).toMatchObject({ is_open: true, capacity_cars: 5, show_phone: false, open_time: null, reason: null });
    expect(fieldErrors(OverrideForm.safeParse({ ...open, capacity_cars: "5", open_time: "12:00", close_time: "09:00" }).error!).close_time).toMatch(/after opening/);
    expect(OverrideForm.parse({ ...open, capacity_cars: "5", open_time: "09:00", close_time: "13:00" })).toMatchObject({ open_time: "09:00", close_time: "13:00" });
  });
  it("a real date; reason ≤ 100", () => {
    expect(fieldErrors(OverrideForm.safeParse({ ...closed, date: "2026-02-30" }).error!).date).toBeTruthy();
    expect(fieldErrors(OverrideForm.safeParse({ ...closed, reason: "x".repeat(101) }).error!).reason).toBeTruthy();
  });
});

it("hhmm trims DB seconds", () => {
  expect(hhmm("08:30:00")).toBe("08:30");
  expect(hhmm(null)).toBe("");
});

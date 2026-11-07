// Settings → Online Booking: form schemas (browser). The DB check constraints repeat every rule.
import { z } from "zod";
import { isoDate } from "./schemas";

export const SENDER_ID_HINT = "Up to 11 letters and numbers, no spaces";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time like 17:00");
const int = (min: number, max: number, msg: string) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.coerce.number(msg).int(msg).min(min, msg).max(max, msg));

/** "08:30:00" (DB) → "08:30" (time input). */
export function hhmm(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : "";
}

/** Zod issues → { field: first message } for inline errors. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = i.path.join(".") || "_";
    out[k] ??= i.message;
  }
  return out;
}

export const GeneralSettings = z
  .object({
    online_enabled: z.boolean(),
    horizon_days: int(1, 90, "Between 1 and 90 days"),
    online_cutoff_time: time,
    cancel_cutoff_time: time,
    reminder_time: time,
    pickup_message: z.string().trim().max(200, "Keep it under 200 characters"),
    price_disclaimer: z.string().trim().max(300, "Keep it under 300 characters"),
    sms_sender_id: z.string().trim().regex(/^[A-Za-z0-9]{1,11}$/, SENDER_ID_HINT),
    sms_enabled: z.boolean(),
    ready_sms_mode: z.enum(["manual", "on_complete"]),
    max_active_per_mobile: int(1, 20, "Between 1 and 20"),
  })
  .strict();
export type GeneralSettingsInput = z.input<typeof GeneralSettings>;

const HOW_MANY = "How many cars? An open day with no capacity shows as full";
const capacity = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.coerce.number().int().min(0).max(200).nullable());

export const WeeklyHoursRow = z
  .object({ weekday: z.number().int().min(1).max(7), is_open: z.boolean(), open_time: time, close_time: time, capacity_cars: capacity })
  .strict()
  .superRefine((r, ctx) => {
    if (r.open_time >= r.close_time) ctx.addIssue({ code: "custom", path: ["close_time"], message: "Closing must be after opening" });
    if (r.is_open && !(r.capacity_cars && r.capacity_cars >= 1)) ctx.addIssue({ code: "custom", path: ["capacity_cars"], message: HOW_MANY });
  })
  .transform((r) => ({ ...r, capacity_cars: r.capacity_cars ?? 0 }));

export const ServiceForm = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(80, "Up to 80 characters"),
    description: z.string().trim().max(300, "Up to 300 characters"),
    price_type: z.enum(["fixed", "from", "quote"]),
    price: z.string().trim(),
    online_bookable: z.boolean(),
    active: z.boolean(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.price_type === "quote") return;
    if (!s.price) ctx.addIssue({ code: "custom", path: ["price"], message: "Enter a price, e.g. 160" });
    else if (!/^\d{1,5}(\.\d{1,2})?$/.test(s.price)) ctx.addIssue({ code: "custom", path: ["price"], message: "Dollars, e.g. 160 or 99.50" });
  })
  .transform(({ price, ...s }) => ({ ...s, price_cents: s.price_type === "quote" ? null : Math.round(Number(price) * 100) }));

export const WindowForm = z
  .object({ start_time: time, end_time: time })
  .strict()
  .refine((w) => w.start_time < w.end_time, { path: ["end_time"], message: "End must be after the start" });

const optTime = z.preprocess((v) => (v === "" ? null : v), time.nullable());

export const OverrideForm = z
  .object({
    date: isoDate,
    is_open: z.boolean(),
    open_time: optTime,
    close_time: optTime,
    capacity_cars: capacity,
    reason: z.string().trim().max(100, "Up to 100 characters"),
    show_phone: z.boolean(),
  })
  .strict()
  .superRefine((o, ctx) => {
    if (!o.is_open) return;
    if (!(o.capacity_cars && o.capacity_cars >= 1)) ctx.addIssue({ code: "custom", path: ["capacity_cars"], message: HOW_MANY });
    if (o.open_time && o.close_time && o.open_time >= o.close_time) {
      ctx.addIssue({ code: "custom", path: ["close_time"], message: "Closing must be after opening" });
    }
  })
  .transform((o) =>
    o.is_open
      ? { ...o, reason: o.reason || null, show_phone: false }
      : { ...o, open_time: null, close_time: null, capacity_cars: null, reason: o.reason || null },
  );
export type OverrideRow = z.output<typeof OverrideForm>;

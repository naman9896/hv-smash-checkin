// Shared booking input schemas (browser + route handlers). The DB checks everything again.
import { z } from "zod";

export const REGO_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "ACT", "NT"] as const;
export const MAX_SERVICES = 5;
export const MAX_NOTES = 1000;
export const MAX_AVAILABILITY_DAYS = 31;

/** Uppercase, letters and digits only (BUSINESS_RULES §8). */
export function normaliseRego(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Australian mobile → E.164 `+614xxxxxxxx`; anything else (landline, 1300…) → null. */
export function normaliseMobile(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (/^04\d{8}$/.test(d)) return `+61${d.slice(1)}`;
  if (/^614\d{8}$/.test(d)) return `+${d}`;
  return null;
}

/** `YYYY-MM-DD` that is a real calendar date. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Not a real date");

const line = (label: string, max: number) =>
  z.string().trim().min(1, `Please enter ${label}`).max(max, `${label[0].toUpperCase()}${label.slice(1)} is too long`);

/** "" → undefined, so optional text boxes can be sent as they are. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

export const PublicCreateBooking = z
  .object({
    serviceIds: z
      .array(z.uuid())
      .min(1, "Please choose at least one service")
      .max(MAX_SERVICES, `Choose up to ${MAX_SERVICES} services`)
      .refine((ids) => new Set(ids).size === ids.length, "A service is listed twice"),
    date: isoDate,
    windowId: z.uuid(),
    customer: z
      .object({
        firstName: line("your first name", 80),
        lastName: line("your last name", 80),
        mobile: z
          .string()
          .transform((v, ctx) => {
            const m = normaliseMobile(v);
            if (!m) {
              ctx.addIssue({ code: "custom", message: "Enter an Australian mobile, e.g. 0412 345 678" });
              return z.NEVER;
            }
            return m;
          }),
        email: optional(z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email, e.g. name@example.com"))),
      })
      .strict(),
    vehicle: z
      .object({
        rego: z
          .string()
          .transform(normaliseRego)
          .pipe(z.string().min(1, "Please enter the registration").max(9, "Up to 9 letters and numbers")),
        state: z.enum(REGO_STATES, "Choose the state"),
        make: line("the vehicle make", 60),
        model: line("the vehicle model", 80),
        year: optional(z.coerce.number().int().min(1950, "Enter a year from 1950").max(2100, "Enter a real year")),
      })
      .strict(),
    notes: optional(z.string().trim().max(MAX_NOTES, `Keep it under ${MAX_NOTES} characters`)),
  })
  .strict();

export type PublicCreateBookingInput = z.input<typeof PublicCreateBooking>;
export type PublicCreateBookingData = z.output<typeof PublicCreateBooking>;

/** The JSON `booking_create` takes (snake_case; see DATA_MODEL §3). */
export function toDbInput(b: PublicCreateBookingData) {
  return {
    service_ids: b.serviceIds,
    date: b.date,
    window_id: b.windowId,
    first_name: b.customer.firstName,
    last_name: b.customer.lastName,
    mobile: b.customer.mobile,
    email: b.customer.email ?? null,
    rego: b.vehicle.rego,
    rego_state: b.vehicle.state,
    make: b.vehicle.make,
    model: b.vehicle.model,
    year: b.vehicle.year ?? null,
    notes: b.notes ?? "",
  };
}

export const AvailabilityQuery = z
  .object({ from: isoDate, to: isoDate })
  .strict()
  .refine((q) => q.to >= q.from, "`to` must not be before `from`")
  .refine(
    (q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < MAX_AVAILABILITY_DAYS,
    `Ask for at most ${MAX_AVAILABILITY_DAYS} days`,
  );

/** Public availability for one day (never the owner's note or exact counts: API_SPEC §1). */
export type PublicDay = { date: string; status: "open" | "full" | "closed"; fewLeft: boolean; callUs: boolean };

export type PublicInfo = {
  business: { name: string; phone: string | null; address: string | null };
  services: { id: string; name: string; description: string; priceType: "fixed" | "from" | "quote"; priceCents: number | null }[];
  windows: { id: string; start: string; end: string }[];
  pickupMessage: string;
  priceDisclaimer: string;
  hours: { weekday: number; isOpen: boolean; open: string; close: string }[];
};

export type CreatedBooking = {
  referenceNo: string;
  date: string;
  window: { start: string; end: string };
  manageUrl: string;
};

/** POST /api/booking/manage/{token}/reschedule (API_SPEC §1). */
export const Reschedule = z.object({ date: isoDate, windowId: z.uuid() }).strict();
export type RescheduleInput = z.input<typeof Reschedule>;

/** What the manage page shows (SECURITY: no surname, mobile, email or notes). */
export type ManageView = {
  referenceNo: string;
  firstName: string;
  rego: string;
  make: string;
  model: string;
  services: string[];
  date: string;
  window: { start: string; end: string };
  status: "booked" | "arrived" | "completed" | "cancelled" | "no_show";
  canChange: boolean;
  /** Sydney wall-clock "YYYY-MM-DDTHH:MM": change/cancel online until then. */
  changeUntil: string;
  business: { phone: string | null };
};

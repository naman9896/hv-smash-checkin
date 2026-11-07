import { z } from "zod";
import type { CheckinInput } from "./types";
import { isValidAuPhone, normaliseAuPhone } from "./utils";

/* ------------------------------------------------------------------ */
/* Kiosk check-in                                                      */
/* One schema for both sides: the kiosk validates with                 */
/* `checkinFormSchema`, the /api/checkin route with                    */
/* `checkinRequestSchema` (the same fields plus the signature).        */
/* The database checks everything again (kiosk_submit_checkin).        */
/* ------------------------------------------------------------------ */

export const MIN_YEAR = 1950;
export const maxYear = () => new Date().getFullYear() + 1;

export const LIMITS = {
  customer_name: 120,
  email: 254,
  make: 60,
  model: 80,
  insurance_company: 120,
  claim_number: 60,
  damage_description: 500,
} as const;

/** Biggest signature PNG we accept (bytes). Matches the `signatures` bucket limit. */
export const SIGNATURE_MAX_BYTES = 512 * 1024;

/** What the kiosk form holds: every field is a string while the customer types. */
export interface CheckinFormValues {
  customer_name: string;
  email: string;
  phone: string;
  make: string;
  model: string;
  year: string;
  job_type: "" | "insurance" | "private";
  insurance_company: string;
  claim_number: string;
  damage_description: string;
}

const required = (max: number, empty: string, tooLong: string) => z.string().trim().min(1, empty).max(max, tooLong);
const optional = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .transform((v) => v || null);

function fields() {
  const top = maxYear();
  return {
    customer_name: required(LIMITS.customer_name, "Please enter your full name", "Name is too long"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Please enter your email address")
      .max(LIMITS.email, "Email is too long")
      .pipe(z.email("Enter a valid email, e.g. name@example.com")),
    phone: z
      .string()
      .trim()
      .min(1, "Please enter your phone number")
      .refine(isValidAuPhone, "Enter a valid Australian number, e.g. 0412 345 678 or 02 4932 4551")
      .transform(normaliseAuPhone),
    make: required(LIMITS.make, "Please enter the vehicle make", "Make is too long"),
    model: required(LIMITS.model, "Please enter the vehicle model", "Model is too long"),
    year: z
      .string()
      .trim()
      .refine((v) => v === "" || (/^\d{4}$/.test(v) && Number(v) >= MIN_YEAR && Number(v) <= top), `Enter a year between ${MIN_YEAR} and ${top}`)
      .transform((v) => (v === "" ? null : Number(v))),
    job_type: z.enum(["", "insurance", "private"], "Choose Insurance or Private").transform((v) => v || null),
    insurance_company: optional(LIMITS.insurance_company, "Insurance company is too long"),
    claim_number: optional(LIMITS.claim_number, "Claim number is too long"),
    damage_description: optional(LIMITS.damage_description, `Keep the description to ${LIMITS.damage_description} characters`),
  };
}

/** Insurance details only make sense for an insurance job: drop them otherwise. */
function clearInsurance<T extends { job_type: string | null; insurance_company: string | null; claim_number: string | null }>(v: T): T {
  return v.job_type === "insurance" ? v : { ...v, insurance_company: null, claim_number: null };
}

/** Kiosk form (client). Output is the clean `CheckinInput`. */
export function checkinFormSchema() {
  return z
    .object(fields())
    .strict()
    .transform((v): CheckinInput => clearInsurance(v));
}

const signature = z
  .string("Please sign in the box")
  .min(1, "Please sign in the box")
  // base64 grows by 4/3; allow a little for the data-URL prefix
  .max(Math.ceil((SIGNATURE_MAX_BYTES * 4) / 3) + 64, "The signature is too large")
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/, "Please sign in the box");

/** POST /api/checkin body: the form fields plus the signature as a PNG data URL. */
export function checkinRequestSchema() {
  return z
    .object({ ...fields(), signature })
    .strict()
    .transform(({ signature, ...v }) => ({ input: clearInsurance(v) as CheckinInput, signature }));
}

/** First message per field, for inline errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const k = String(issue.path[0] ?? "form");
    out[k] ??= issue.message;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Owner                                                               */
/* ------------------------------------------------------------------ */

export const pinSchema = z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits");

export const passwordSchema = z.string().min(8, "Use at least 8 characters");

/** 0–4 score for the password strength meter. */
export function passwordStrength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < 8) score = Math.min(score, 1);
  return { score, label: ["Too short", "Weak", "Fair", "Good", "Strong"][score] };
}

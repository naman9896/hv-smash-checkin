import { z } from "zod";
import type { KioskSettings } from "./types";
import { isValidAuMobile } from "./utils";

/** Kiosk form schema. Hidden fields (per Settings) are not validated. */
export function kioskSchema(s: Pick<KioskSettings, "show_year" | "email_required">) {
  const thisYear = new Date().getFullYear();
  const email = z.string().trim();
  return z.object({
    first_name: z.string().trim().min(1, "Please enter your first name").max(80),
    last_name: z.string().trim().min(1, "Please enter your last name").max(80),
    phone: z
      .string()
      .trim()
      .min(1, "Please enter your mobile number")
      .refine(isValidAuMobile, "Enter a valid Australian mobile, e.g. 0412 345 678"),
    email: s.email_required
      ? email.min(1, "Please enter your email address").pipe(z.email("Enter a valid email, e.g. name@example.com"))
      : email.refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email, e.g. name@example.com"),
    make: z.string().trim().min(1, "Please select the vehicle make").max(60),
    model: z.string().trim().min(1, "Please enter the vehicle model").max(80),
    year: s.show_year
      ? z
          .string()
          .refine(
            (v) => v === "" || (Number(v) >= 1950 && Number(v) <= thisYear + 1),
            `Enter a year between 1950 and ${thisYear + 1}`,
          )
      : z.string(),
    rego: z
      .string()
      .trim()
      .min(1, "Please enter the registration")
      .regex(/^[A-Z0-9]{1,7}$/, "Letters and numbers only, up to 7 characters"),
    colour: z.string().max(40),
    odometer: z.string().regex(/^\d{0,7}$/, "Numbers only"),
  });
}

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

/**
 * Job sheet checks. Returns field → message.
 * Staff must give model and KMs; the owner can save older jobs without them.
 */
export function validateJob(
  j: {
    employee_name: string;
    phone: string | null;
    email: string | null;
    rego: string;
    make: string;
    model: string | null;
    odometer: string | null;
    year: number | null;
    vin: string | null;
    work_items: string[];
  },
  mode: "staff" | "owner" = "staff",
): Record<string, string> {
  const e: Record<string, string> = {};
  const thisYear = new Date().getFullYear();
  if (!j.employee_name.trim()) e.employee_name = "Choose your name";
  if (j.phone?.trim() && !/^[\d\s+()-]{8,20}$/.test(j.phone.trim())) e.phone = "Enter a valid phone number";
  if (j.email?.trim() && !z.email().safeParse(j.email.trim()).success) e.email = "Enter a valid email";
  if (!j.rego.trim()) e.rego = "Enter the rego";
  if (!j.make.trim()) e.make = "Select the vehicle make";
  if (mode === "staff" && !j.model?.trim()) e.model = "Enter the model";
  if (mode === "staff" && !j.odometer?.replace(/\D/g, "")) e.odometer = "Enter the KMs";
  if (j.year != null && (j.year < 1950 || j.year > thisYear + 1)) e.year = `Year between 1950 and ${thisYear + 1}`;
  if (j.vin?.trim() && j.vin.trim().length > 17) e.vin = "A VIN is 17 characters";
  if (!j.work_items.some((w) => w.trim())) e.work_items = "Add at least one line of work carried out";
  return e;
}

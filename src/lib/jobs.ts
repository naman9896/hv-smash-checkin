import type { Job, JobPart, JobStaffFields } from "./types";

export const VEHICLE_TYPES = ["Sedan", "Hatchback", "SUV", "Ute", "Wagon", "Van", "Coupe", "Convertible", "People mover", "4WD", "Truck", "Motorbike", "Other"];

/** Blank staff-fillable job, with a few empty lines like the paper sheet. */
export function blankJob(): JobStaffFields {
  return {
    employee_name: "",
    customer_name: "",
    phone: "",
    email: "",
    address: "",
    rego: "",
    make: "",
    model: "",
    vehicle_type: "",
    vin: "",
    year: null,
    colour: "",
    odometer: "",
    hours: "",
    work_items: [""],
    faults: "",
    parts: [],
  };
}

/** "Hours taken" choices: 0.5 to 12 hours in half-hour steps (stored as "0.5", "1", "1.5"…). */
export const HOURS_OPTIONS = Array.from({ length: 24 }, (_, i) => String((i + 1) / 2));

/** "1 hour", "1.5 hours", "30 min". */
export function formatHours(h: string | number | null | undefined): string {
  if (h == null || h === "") return "";
  const n = Number(h);
  if (!Number.isFinite(n)) return String(h);
  if (n === 0.5) return "30 min";
  return `${n} ${n === 1 ? "hour" : "hours"}`;
}

/** Quick-pick buttons above "Work Carried Out" (tap to add a line). */
export const COMMON_WORK = [
  "Logbook Service",
  "Minor Service",
  "Major Service",
  "Oil & Filter Change",
  "Brake Pads – Front",
  "Brake Pads – Rear",
  "Brake Discs – Machine/Replace",
  "Brake Fluid Flush",
  "Tyres",
  "Wheel Alignment",
  "Wheel Balance",
  "Tyre Rotation",
  "Battery Replacement",
  "Air Con Re-gas",
  "Coolant Flush",
  "Transmission Service",
  "Timing Belt",
  "Spark Plugs",
  "Clutch",
  "Suspension Check",
  "Diagnostic Scan",
  "Pink Slip Inspection",
  "Blue Slip Inspection",
  "Wiper Blades",
];

/** Quick-pick buttons above "Parts Used" (tap to add the part, qty 1). */
export const COMMON_PARTS = [
  "Engine Oil",
  "Oil Filter",
  "Air Filter",
  "Cabin / A/C Filter",
  "Fuel Filter",
  "Spark Plugs",
  "Brake Pads – Front",
  "Brake Pads – Rear",
  "Brake Discs",
  "Brake Fluid",
  "Coolant",
  "Battery",
  "Tyre",
  "Wiper Blades",
  "Drive Belt",
  "Timing Belt Kit",
  "Transmission Fluid",
  "Power Steering Fluid",
  "Globe / Bulb",
  "Washer Fluid",
];

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
export const formatMoney = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? "—" : money.format(n));

export function partsSubtotal(parts: JobPart[]): number {
  return parts.reduce((t, p) => t + (Number(p.qty) || 0) * (Number(p.price) || 0), 0);
}

export function jobTotals(j: Pick<Job, "parts" | "labour_total">) {
  const parts = partsSubtotal(j.parts ?? []);
  const labour = Number(j.labour_total) || 0;
  return { parts, labour, total: parts + labour };
}

/** Hours between time in and time out, e.g. "2.5", or null. */
export function totalHours(timeIn: string | null, timeOut: string | null): string | null {
  if (!timeIn || !timeOut) return null;
  const h = (new Date(timeOut).getTime() - new Date(timeIn).getTime()) / 3_600_000;
  if (!Number.isFinite(h) || h < 0) return null;
  return (Math.round(h * 4) / 4).toString();
}

/** Trim and drop empty lines/parts before saving. */
export function cleanJob<T extends JobStaffFields>(j: T): T {
  const t = (v: string | null) => (v ?? "").trim() || null;
  return {
    ...j,
    employee_name: j.employee_name.trim(),
    customer_name: t(j.customer_name),
    phone: t(j.phone),
    email: t(j.email)?.toLowerCase() ?? null,
    address: t(j.address),
    rego: j.rego.toUpperCase().replace(/[^A-Z0-9]/g, ""),
    make: j.make.trim(),
    model: t(j.model),
    vehicle_type: t(j.vehicle_type),
    vin: t(j.vin)?.toUpperCase() ?? null,
    colour: t(j.colour),
    odometer: (j.odometer ?? "").replace(/\D/g, "") || null,
    hours: t(j.hours),
    work_items: j.work_items.map((w) => w.trim()).filter(Boolean),
    faults: t(j.faults),
    parts: j.parts
      .map((p) => ({ ...p, description: p.description.trim(), qty: Number(p.qty) || 1 }))
      .filter((p) => p.description),
  };
}

/** Just the editable fields of a saved job (no id, job number, timestamps or check-in link). */
export function jobFormValue(j: Job): JobStaffFields & Omit<Job, "id" | "job_no" | "created_at" | "updated_at" | "is_read" | "checkin_id" | keyof JobStaffFields> {
  return {
    employee_name: j.employee_name,
    customer_name: j.customer_name,
    phone: j.phone,
    email: j.email,
    address: j.address,
    rego: j.rego,
    make: j.make,
    model: j.model,
    vehicle_type: j.vehicle_type,
    vin: j.vin,
    year: j.year,
    colour: j.colour,
    odometer: j.odometer,
    hours: j.hours,
    work_items: j.work_items.length ? j.work_items : [""],
    faults: j.faults,
    parts: j.parts ?? [],
    status: j.status,
    time_in: j.time_in,
    time_out: j.time_out,
    labour_total: j.labour_total == null ? null : Number(j.labour_total),
    po_number: j.po_number,
    tax_invoice_number: j.tax_invoice_number,
    invoice_sent_on: j.invoice_sent_on,
    owner_notes: j.owner_notes,
  };
}

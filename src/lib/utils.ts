import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Digits only, national format: "+61 412 345 678" → "0412345678", "(02) 4932 4551" → "0249324551". */
export function normaliseAuPhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("61")) d = "0" + d.slice(2);
  if (d.startsWith("00")) d = d.slice(1); // +61 (0)4… typed with the trunk zero
  return d;
}

/** Australian mobile (04/05) or landline (02, 03, 07, 08): 10 digits. */
export function isValidAuPhone(raw: string): boolean {
  return /^0[2-578]\d{8}$/.test(normaliseAuPhone(raw));
}

const isMobile = (d: string) => /^0[45]/.test(d);

/** Format as you type / for display: mobiles 0412 345 678, landlines 02 4932 4551. */
export function formatAuPhone(raw: string): string {
  const d = normaliseAuPhone(raw).slice(0, 10);
  if (isMobile(d) || d.length < 2) {
    if (d.length <= 4) return d;
    if (d.length <= 7) return `${d.slice(0, 4)} ${d.slice(4)}`;
    return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  }
  if (d.length <= 2) return d;
  if (d.length <= 6) return `${d.slice(0, 2)} ${d.slice(2)}`;
  return `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
}

/** "Mobile" or "Phone" for a stored number. */
export function phoneLabel(p: string): string {
  return isMobile(normaliseAuPhone(p)) ? "Mobile" : "Phone";
}

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h > 1 ? "s" : ""} ago`;
  return formatDateTime(iso);
}

export function vehicleTitle(c: { year: number | null; make: string; model: string }) {
  return [c.year, c.make, c.model].filter(Boolean).join(" ");
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

export type DateRange = "all" | "today" | "week" | "month" | "custom";

/** [from, to) as Date objects for a dashboard date filter. Weeks start on Monday. */
export function rangeBounds(range: DateRange, customFrom?: string, customTo?: string): { from: Date | null; to: Date | null } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === "today") return { from: start, to: null };
  if (range === "week") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return { from: start, to: null };
  }
  if (range === "month") {
    start.setDate(1);
    return { from: start, to: null };
  }
  if (range === "custom") return dayInputBounds(customFrom, customTo);
  return { from: null, to: null };
}

/** Bounds from two <input type="date"> values; the end day is inclusive. */
export function dayInputBounds(from?: string, to?: string): { from: Date | null; to: Date | null } {
  const f = from ? new Date(`${from}T00:00:00`) : null;
  let t: Date | null = null;
  if (to) {
    t = new Date(`${to}T00:00:00`);
    t.setDate(t.getDate() + 1);
  }
  return { from: f, to: t };
}

export function phoneDigits(p: string | null | undefined): string {
  return normaliseAuPhone(p ?? "");
}

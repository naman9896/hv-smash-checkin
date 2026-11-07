import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Strip everything but digits; convert +61 to a leading 0. */
export function normaliseAuMobile(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("61")) d = "0" + d.slice(2);
  return d;
}

/** AU mobile: 04xx xxx xxx (10 digits starting 04). */
export function isValidAuMobile(raw: string): boolean {
  return /^04\d{8}$/.test(normaliseAuMobile(raw));
}

/** Format as you type: 0412 345 678 */
export function formatAuMobile(raw: string): string {
  const d = normaliseAuMobile(raw).slice(0, 10);
  if (d.length <= 4) return d;
  if (d.length <= 7) return `${d.slice(0, 4)} ${d.slice(4)}`;
  return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
}

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

export function formatKm(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return new Intl.NumberFormat("en-AU").format(n);
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

export function vehicleTitle(c: { year: number | null; make: string; model: string; colour: string | null }) {
  const base = [c.year, c.make, c.model].filter(Boolean).join(" ");
  return c.colour ? `${base} · ${c.colour}` : base;
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
  return normaliseAuMobile(p ?? "");
}

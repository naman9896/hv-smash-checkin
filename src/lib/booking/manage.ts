// The customer's manage link (/b/{token}): pure helpers shared by the page and the route handlers.
import { formatDayLong } from "./format";
import type { ErrorCode } from "./errors";
import type { ManageView } from "./schemas";

/** 32 random bytes as base64url, no padding (booking_create). Anything else is a 404 without a DB call. */
export function isManageToken(t: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(t);
}

export type DbManageView = {
  reference_no: string; first_name: string; rego: string; make: string; model: string; services: string[];
  date: string; window_start: string; window_end: string; status: ManageView["status"]; can_change: boolean;
  change_until: string; phone: string | null;
};

export function toManageView(v: DbManageView): ManageView {
  return {
    referenceNo: v.reference_no,
    firstName: v.first_name,
    rego: v.rego,
    make: v.make,
    model: v.model,
    services: v.services,
    date: v.date,
    window: { start: v.window_start, end: v.window_end },
    status: v.status,
    canChange: v.can_change,
    changeUntil: v.change_until,
    business: { phone: v.phone },
  };
}

/** "2026-11-19T17:00" → "5pm Thursday 19 November". */
export function formatChangeUntil(local: string): string {
  const [date, time] = local.split("T");
  const [h, m] = time.split(":").map(Number);
  const clock = `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h >= 12 ? "pm" : "am"}`;
  return `${clock} ${formatDayLong(date)}`;
}

/**
 * Messages for someone holding a manage link, where they differ from the booking-page ones
 * (errors.ts). undefined → use the normal message.
 */
export function manageErrorMessage(code: ErrorCode, details: string | null): string | undefined {
  switch (code) {
    case "NOT_FOUND":
      return "This booking link isn't valid any more. Please check the link in your text, or give us a call.";
    case "CUTOFF_PASSED":
      return details === "booking" ? "It's too late to change this booking online. Please give us a call." : undefined;
    case "INVALID_TRANSITION":
      return details === "unchanged" ? "That's already your drop-off day." : "This booking can't be changed any more.";
    default:
      return undefined;
  }
}

// API error codes (API_SPEC "Conventions"). booking_* DB functions raise the code as the
// exception message (SQLSTATE P0001); route handlers turn it into { error: { code, message } }.
import { formatDay } from "./format";

export const ERRORS = {
  VALIDATION: { status: 400, message: "Please check your details and try again." },
  NOT_FOUND: { status: 404, message: "That service or booking isn't available any more. Please refresh and try again." },
  FULL: { status: 409, message: "Sorry, that day has just filled up. Please choose another day." },
  DUPLICATE_BOOKING: { status: 409, message: "This car is already booked in for that day." },
  CLOSED: { status: 422, message: "We're closed that day. Please choose another day." },
  CUTOFF_PASSED: { status: 422, message: "It's too late to book that day online. Please choose a later day or give us a call." },
  OUTSIDE_HORIZON: { status: 422, message: "That day is too far ahead to book online. Please choose an earlier day." },
  MOBILE_LIMIT: { status: 422, message: "This mobile number already has the most bookings we take online. Please call us to book another." },
  INVALID_TRANSITION: { status: 422, message: "That change isn't possible for this booking." },
  RATE_LIMITED: { status: 429, message: "Too many attempts. Please wait a minute and try again." },
  BOOKING_OFF: { status: 503, message: "Online booking is paused right now. Please call us to book." },
} as const;

export type ErrorCode = keyof typeof ERRORS;

export type FieldIssue = { path: string; message: string };

export function errorResponse(code: ErrorCode, message?: string, issues?: FieldIssue[]): Response {
  const e = ERRORS[code];
  return Response.json(
    { error: { code, message: message ?? e.message, ...(issues?.length ? { issues } : {}) } },
    { status: e.status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Map a Supabase/PostgREST error from a booking_* function. Only known codes pass through;
 * anything else is a generic 500 (no SQL, constraint names or personal data in the response).
 */
export function errorResponseFor(
  err: { code?: string; message?: string; details?: string | null },
  messageFor?: (code: ErrorCode, details: string | null) => string | undefined,
): Response {
  const code = err.code === "P0001" && err.message && err.message in ERRORS ? (err.message as ErrorCode) : null;
  if (!code) {
    return Response.json(
      { error: { code: "SERVER_ERROR", message: "Something went wrong on our side. Please try again, or give us a call." } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  const custom = messageFor?.(code, err.details ?? null);
  if (custom) return errorResponse(code, custom);
  if (code === "DUPLICATE_BOOKING" && err.details && /^\d{4}-\d{2}-\d{2}$/.test(err.details)) {
    return errorResponse(code, `This car is already booked in for ${formatDay(err.details)}.`);
  }
  return errorResponse(code);
}

import "server-only";
import { errorResponse, type FieldIssue } from "./errors";
import type { ZodError } from "zod";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Zod issues → `[{path, message}]` for inline form errors (messages are ours, never user input). */
export function zodIssues(err: ZodError): FieldIssue[] {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export function validationError(err: ZodError): Response {
  return errorResponse("VALIDATION", undefined, zodIssues(err));
}

/** Log without personal data: only a label and a DB error code (CLAUDE.md: no mobiles, names, notes, tokens). */
export function logFailure(label: string, err: unknown) {
  const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "unknown";
  console.error(`[booking] ${label} failed (code ${code})`);
}

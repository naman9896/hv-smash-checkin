// Server side of the manage link: the /b/{token} page and /api/booking/manage/* both call these.
// Service role (booking_*_by_token are service_role only). Never log the token (SECURITY §3).
import "server-only";
import { isManageToken, toManageView, type DbManageView } from "./manage";
import type { ManageView, RescheduleInput } from "./schemas";
import { bookingDb } from "./server";

export type DbError = { code?: string; message?: string; details?: string | null };
export type ManageResult = { ok: true; view: ManageView } | { ok: false; error: DbError };

const NOT_FOUND: ManageResult = { ok: false, error: { code: "P0001", message: "NOT_FOUND", details: "token" } };

async function run(fn: string, args: Record<string, unknown>): Promise<ManageResult> {
  if (!isManageToken(String(args.p_token))) return NOT_FOUND;
  const { data, error } = await bookingDb().rpc(fn, args);
  if (error) return { ok: false, error };
  return { ok: true, view: toManageView(data as DbManageView) };
}

export const viewByToken = (token: string) => run("booking_by_token", { p_token: token });
export const cancelByToken = (token: string) => run("booking_cancel_by_token", { p_token: token });
export const rescheduleByToken = (token: string, r: RescheduleInput) =>
  run("booking_reschedule_by_token", { p_token: token, p_date: r.date, p_window_id: r.windowId });

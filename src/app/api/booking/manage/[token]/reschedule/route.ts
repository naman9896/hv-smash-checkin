import { after } from "next/server";
import { errorResponse } from "@/lib/booking/errors";
import { logFailure, zodIssues } from "@/lib/booking/http";
import { MANAGE_HEADERS, manageResponse, manageServerError } from "@/lib/booking/manage-http";
import { rescheduleByToken } from "@/lib/booking/manage-server";
import { Reschedule } from "@/lib/booking/schemas";
import { dispatchDue } from "@/lib/booking/sms/run";

const MAX_BODY_BYTES = 1_000;

/**
 * POST /api/booking/manage/{token}/reschedule — the customer moves their booking (API_SPEC §1).
 * Same rules as a new online booking (advisory lock in the DB), until 17:00 the day before the
 * current drop-off. The link stays the same. Queues the 'rescheduled' SMS.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/booking/manage/[token]/reschedule">) {
  const text = await request.text();
  let json: unknown;
  try {
    json = text.length > MAX_BODY_BYTES ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }
  const parsed = Reschedule.safeParse(json);
  if (!parsed.success) {
    const res = errorResponse("VALIDATION", undefined, json === undefined ? undefined : zodIssues(parsed.error));
    for (const [k, v] of Object.entries(MANAGE_HEADERS)) res.headers.set(k, v);
    return res;
  }
  try {
    const r = await rescheduleByToken((await ctx.params).token, parsed.data);
    if (r.ok) {
      after(async () => {
        try {
          await dispatchDue(10);
        } catch (err) {
          logFailure("dispatch kick", err);
        }
      });
    }
    return manageResponse(r, "manage reschedule");
  } catch (err) {
    return manageServerError("manage reschedule", err);
  }
}

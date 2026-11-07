import { after } from "next/server";
import { logFailure } from "@/lib/booking/http";
import { manageResponse, manageServerError } from "@/lib/booking/manage-http";
import { cancelByToken } from "@/lib/booking/manage-server";
import { dispatchDue } from "@/lib/booking/sms/run";

/**
 * POST /api/booking/manage/{token}/cancel — the customer cancels (API_SPEC §1, BUSINESS_RULES §9).
 * Only 'booked', until 17:00 the day before. Queues the 'cancelled' SMS and sends it straight after.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/booking/manage/[token]/cancel">) {
  try {
    const r = await cancelByToken((await ctx.params).token);
    if (r.ok) kickDispatch();
    return manageResponse(r, "manage cancel");
  } catch (err) {
    return manageServerError("manage cancel", err);
  }
}

function kickDispatch() {
  after(async () => {
    try {
      await dispatchDue(10);
    } catch (err) {
      logFailure("dispatch kick", err);
    }
  });
}

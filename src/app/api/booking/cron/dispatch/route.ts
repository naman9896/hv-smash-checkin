import { cronRoute } from "@/lib/booking/cron";
import { dispatchDue } from "@/lib/booking/sms/run";

export const maxDuration = 60;

/** GET /api/booking/cron/dispatch — every minute: send up to 50 due SMS (API_SPEC §3). */
export function GET(request: Request) {
  return cronRoute(request, "dispatch", () => dispatchDue(50));
}

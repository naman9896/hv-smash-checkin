import { cronRoute } from "@/lib/booking/cron";
import { bookingDb } from "@/lib/booking/server";

/**
 * GET /api/booking/cron/reminders — every 15 min. The DB function only queues once it is
 * reminder_time (10:00) in Sydney, and the dedupe key stops repeats; dispatch sends them.
 */
export function GET(request: Request) {
  return cronRoute(request, "reminders", async () => {
    const { data, error } = await bookingDb().rpc("booking_enqueue_reminders");
    if (error) throw error;
    return { queued: data as number };
  });
}

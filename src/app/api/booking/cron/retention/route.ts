import { cronRoute } from "@/lib/booking/cron";
import { bookingDb } from "@/lib/booking/server";

/** GET /api/booking/cron/retention — daily: SMS rows > 2 years, expired manage tokens. */
export function GET(request: Request) {
  return cronRoute(request, "retention", async () => {
    const { data, error } = await bookingDb().rpc("booking_retention");
    if (error) throw error;
    return data;
  });
}

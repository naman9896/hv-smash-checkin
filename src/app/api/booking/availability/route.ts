import { connection, type NextRequest } from "next/server";
import { errorResponseFor } from "@/lib/booking/errors";
import { logFailure, NO_STORE, validationError } from "@/lib/booking/http";
import { AvailabilityQuery, type PublicDay } from "@/lib/booking/schemas";
import { bookingDb } from "@/lib/booking/server";

type DbDay = { day: string; status: "open" | "full" | "closed"; spots_left: number; call_us: boolean };

/**
 * GET /api/booking/availability?from=YYYY-MM-DD&to=YYYY-MM-DD — public, online rules applied.
 * Returns only date + status (+ "few left" and "call us"): never the owner's note or exact counts.
 */
export async function GET(request: NextRequest) {
  await connection();
  const parsed = AvailabilityQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { data, error } = await bookingDb().rpc("booking_availability", {
      p_from: parsed.data.from,
      p_to: parsed.data.to,
      p_online: true,
    });
    if (error) {
      logFailure("availability", error);
      return errorResponseFor(error);
    }
    const days: PublicDay[] = (data as DbDay[]).map((d) => ({
      date: d.day,
      status: d.status,
      fewLeft: d.status === "open" && d.spots_left <= 2,
      callUs: d.call_us,
    }));
    return Response.json({ days }, { headers: NO_STORE });
  } catch (err) {
    logFailure("availability", err);
    return errorResponseFor({});
  }
}

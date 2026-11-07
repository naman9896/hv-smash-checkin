import { after } from "next/server";
import { errorResponse, errorResponseFor } from "@/lib/booking/errors";
import { logFailure, NO_STORE, validationError } from "@/lib/booking/http";
import { PublicCreateBooking, toDbInput, type CreatedBooking } from "@/lib/booking/schemas";
import { bookingDb, manageUrl } from "@/lib/booking/server";
import { dispatchDue } from "@/lib/booking/sms/run";

const MAX_BODY_BYTES = 10_000;

type DbCreated = { id: string; reference_no: string; token: string; date: string; window_start: string; window_end: string };

/**
 * POST /api/booking — public online booking (API_SPEC §1).
 * Zod .strict() here, then booking_create re-validates and enforces capacity (advisory lock),
 * one booking per rego per day and the per-mobile limit. The confirmation SMS is queued in the
 * same transaction; after the response, a small dispatch run sends it straight away (the
 * every-minute cron is the backstop). An SMS problem never fails the booking.
 * Not here yet (T9): BotID check and the Vercel WAF rate limit.
 */
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return errorResponse("VALIDATION", "That request is too large.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return errorResponse("VALIDATION");
  }
  const parsed = PublicCreateBooking.safeParse(json);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const { data, error } = await bookingDb().rpc("booking_create", {
      p: toDbInput(parsed.data),
      p_source: "online",
      p_allow_over: false,
    });
    if (error) {
      if (!(error.code === "P0001")) logFailure("create", error); // expected business errors aren't logged
      return errorResponseFor(error);
    }
    const b = data as DbCreated;
    after(async () => {
      try {
        await dispatchDue(10);
      } catch (err) {
        logFailure("dispatch kick", err);
      }
    });
    const body: CreatedBooking = {
      referenceNo: b.reference_no,
      date: b.date,
      window: { start: b.window_start, end: b.window_end },
      manageUrl: manageUrl(b.token),
    };
    return Response.json(body, { status: 201, headers: { ...NO_STORE, "Referrer-Policy": "no-referrer" } });
  } catch (err) {
    logFailure("create", err);
    return errorResponseFor({});
  }
}

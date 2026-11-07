import { connection } from "next/server";
import { errorResponseFor } from "@/lib/booking/errors";
import { logFailure, NO_STORE } from "@/lib/booking/http";
import type { PublicInfo } from "@/lib/booking/schemas";
import { bookingDb } from "@/lib/booking/server";

type DbInfo = {
  online_enabled: boolean;
  business: { name: string; phone: string | null; address: string | null };
  pickup_message: string;
  price_disclaimer: string;
  services: { id: string; name: string; description: string; price_type: "fixed" | "from" | "quote"; price_cents: number | null }[];
  windows: { id: string; start_time: string; end_time: string }[];
  hours: { weekday: number; is_open: boolean; open_time: string; close_time: string }[];
};

/** GET /api/booking/info — public: business details, services, windows (API_SPEC §1). */
export async function GET() {
  await connection(); // settings change at any time: never prerender
  try {
    const { data, error } = await bookingDb().rpc("booking_public_info");
    if (error) {
      logFailure("info", error);
      return errorResponseFor(error);
    }
    const d = data as DbInfo;
    if (!d.online_enabled) {
      // The page still needs the phone number for "call us"
      return Response.json(
        { error: { code: "BOOKING_OFF", message: "Online booking is paused right now. Please call us to book." }, business: d.business },
        { status: 503, headers: NO_STORE },
      );
    }
    const info: PublicInfo = {
      business: d.business,
      services: d.services.map((s) => ({ id: s.id, name: s.name, description: s.description, priceType: s.price_type, priceCents: s.price_cents })),
      windows: d.windows.map((w) => ({ id: w.id, start: w.start_time, end: w.end_time })),
      pickupMessage: d.pickup_message,
      priceDisclaimer: d.price_disclaimer,
      hours: d.hours.map((h) => ({ weekday: h.weekday, isOpen: h.is_open, open: h.open_time, close: h.close_time })),
    };
    return Response.json(info, { headers: NO_STORE });
  } catch (err) {
    logFailure("info", err);
    return errorResponseFor({});
  }
}


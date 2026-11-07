import { createClient } from "@supabase/supabase-js";
import { checkinRequestSchema, fieldErrors, SIGNATURE_MAX_BYTES } from "@/lib/validation";

/**
 * POST /api/checkin: the kiosk's only write.
 *   1. Validates the body with the same Zod schema as the form (strict: unknown fields are rejected).
 *   2. Uploads the signature PNG to the private `signatures` bucket as <id>.png.
 *   3. Calls kiosk_submit_checkin, which checks everything again in the database.
 * Uses the anon key: the database grants anon nothing beyond this (see the migration).
 * Never logs customer details.
 */

// Signature (≤ 512 KB as base64 ≈ 700 KB) plus the text fields
const MAX_BODY_CHARS = 800_000;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** The signature as PNG bytes, or null unless it really is a PNG within the size limit. */
function decodeSignature(dataUrl: string): Uint8Array | null {
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  if (bytes.length < 100 || bytes.length > SIGNATURE_MAX_BYTES) return null;
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) return null;
  return new Uint8Array(bytes);
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return json(503, { error: "Check-in isn't set up yet. Please see the front counter." });

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return json(415, { error: "Unsupported request." });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return json(413, { error: "The signature is too large. Please clear it and sign again.", fields: { signature: "Please sign again" } });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "Invalid request." });
  }

  const parsed = checkinRequestSchema().safeParse(body);
  if (!parsed.success) {
    return json(400, { error: "Please check the highlighted fields.", fields: fieldErrors(parsed.error) });
  }
  const { input, signature } = parsed.data;

  const png = decodeSignature(signature);
  if (!png) return json(400, { error: "Please sign again.", fields: { signature: "Please sign in the box" } });

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const id = crypto.randomUUID();

  const upload = await supabase.storage.from("signatures").upload(`${id}.png`, png, { contentType: "image/png", upsert: false });
  if (upload.error) {
    console.error("[api/checkin] signature upload failed");
    return json(502, { error: "We couldn't save your signature. Please try again." });
  }

  const { data, error } = await supabase.rpc("kiosk_submit_checkin", {
    p_id: id,
    p_customer_name: input.customer_name,
    p_email: input.email,
    p_phone: input.phone,
    p_make: input.make,
    p_model: input.model,
    p_year: input.year,
    p_job_type: input.job_type,
    p_insurance_company: input.insurance_company,
    p_claim_number: input.claim_number,
    p_damage_description: input.damage_description,
  });

  if (error) {
    // Only the error code: messages can echo customer input
    console.error(`[api/checkin] kiosk_submit_checkin failed (${error.code})`);
    if (error.code === "P0002") return json(503, { error: "Check-in is paused. Please see the front counter." });
    if (error.code === "23514" || error.code === "22023") return json(400, { error: "Please check your details and try again." });
    return json(500, { error: "Something went wrong. Please try again or ask a staff member." });
  }

  return json(201, { reference_no: String(data) });
}

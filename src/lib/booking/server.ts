// Service-role Supabase client for booking route handlers. NEVER import this from client code:
// `server-only` makes that a build error. The key never gets a NEXT_PUBLIC_ prefix.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export class BookingConfigError extends Error {}

export function bookingDb(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new BookingConfigError("Booking is not configured (Supabase URL / service role key missing).");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** Base for links in responses and SMS. Always from env, never from the request Host header (SECURITY §3). */
export function publicBaseUrl(): string {
  const raw = process.env.PUBLIC_BASE_URL;
  if (!raw) throw new BookingConfigError("PUBLIC_BASE_URL is not set.");
  return raw.replace(/\/+$/, "");
}

export function manageUrl(token: string): string {
  return `${publicBaseUrl()}/b/${token}`;
}

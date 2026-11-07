"use client";

/**
 * Data access for the whole app (Supabase Postgres, Storage, Realtime, Auth).
 * UI code talks to these functions, never to Supabase directly.
 */
import bcrypt from "bcryptjs";
import { getSupabase } from "./supabase";
import { DEFAULT_KIOSK_SETTINGS } from "./settings";
import type { Checkin, CheckinPatch, KioskSettings, Settings, SettingsPatch } from "./types";
import type { CheckinFormValues } from "./validation";

const SETTINGS_COLUMNS =
  "owner_name, abn, phone, email, address, opening_hours, auto_lock_minutes, kiosk_enabled, " +
  "kiosk_paused_message, kiosk_title, kiosk_subtitle, consent_text, thank_you_reset_seconds, idle_timeout_minutes, " +
  "sound_enabled, chime, browser_notifications, email_alerts, archive_after_months, updated_at";

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/* Kiosk (anon)                                                        */
/* ------------------------------------------------------------------ */

/** Thrown by `submitCheckin`; `fields` holds the server's per-field messages (same wording as the form). */
export class CheckinError extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

/**
 * Sends the form to POST /api/checkin, which validates it again, stores the signature and
 * creates the check-in. Returns only the reference number: the kiosk never reads the table.
 */
export async function submitCheckin(values: CheckinFormValues, signature: string): Promise<{ reference_no: string }> {
  let res: Response;
  try {
    res = await fetch("/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, signature }),
    });
  } catch {
    throw new CheckinError("No connection. Check the iPad's Wi-Fi and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { reference_no?: string; error?: string; fields?: Record<string, string> };
  if (!res.ok || !body.reference_no) {
    throw new CheckinError(body.error ?? "Please try again or ask a staff member.", body.fields);
  }
  return { reference_no: body.reference_no };
}

export async function getKioskSettings(): Promise<KioskSettings> {
  const { data, error } = await getSupabase().from("kiosk_settings").select("*").maybeSingle();
  fail(error);
  return { ...DEFAULT_KIOSK_SETTINGS, ...(data ?? {}) } as KioskSettings;
}

/** Fires whenever the owner saves settings. Works for the anon kiosk (no settings data is sent). */
export function onSettingsChanged(cb: () => void): () => void {
  const sb = getSupabase();
  const channel = sb
    .channel(`settings-signal-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "settings_signal" }, () => cb())
    .subscribe();
  return () => {
    sb.removeChannel(channel);
  };
}

/** Checks the owner PIN in the database (bcrypt, rate limited). Throws when locked out. */
export async function verifyPin(pin: string): Promise<boolean> {
  const { data, error } = await getSupabase().rpc("verify_pin", { pin });
  fail(error);
  return data === true;
}

/* ------------------------------------------------------------------ */
/* Check-ins (owner)                                                   */
/* ------------------------------------------------------------------ */

export async function listCheckins({ archived = false }: { archived?: boolean } = {}): Promise<Checkin[]> {
  let q = getSupabase().from("checkins").select("*").order("created_at", { ascending: false }).limit(2000);
  if (!archived) q = q.eq("is_archived", false);
  const { data, error } = await q;
  fail(error);
  return data as Checkin[];
}

export async function getCheckin(id: string): Promise<Checkin | null> {
  const { data, error } = await getSupabase().from("checkins").select("*").eq("id", id).maybeSingle();
  fail(error);
  return data as Checkin | null;
}

/** Every check-in from one customer (same phone number), newest first. */
export async function listByPhone(phone: string): Promise<Checkin[]> {
  const { data, error } = await getSupabase()
    .from("checkins")
    .select("*")
    .eq("phone", phone)
    .order("created_at", { ascending: false });
  fail(error);
  return data as Checkin[];
}

/** Export / privacy search across ALL check-ins, archived included. */
export async function queryCheckins(opts: {
  from?: string | null;
  to?: string | null;
  status?: string | null;
  search?: string | null;
}): Promise<Checkin[]> {
  let q = getSupabase().from("checkins").select("*").order("created_at", { ascending: false }).limit(10000);
  if (opts.from) q = q.gte("created_at", opts.from);
  if (opts.to) q = q.lt("created_at", opts.to);
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  const s = opts.search?.trim();
  if (s) {
    const safe = s.replace(/[%,()*]/g, " ").trim();
    const digits = s.replace(/\D/g, "");
    const ors = [`email.ilike.%${safe}%`, `customer_name.ilike.%${safe}%`, `claim_number.ilike.%${safe}%`, `reference_no.ilike.%${safe}%`];
    // Phones are stored as digits only
    if (digits.length >= 6) ors.push(`phone.ilike.%${digits}%`);
    q = q.or(ors.join(","));
  }
  const { data, error } = await q;
  fail(error);
  return data as Checkin[];
}

export async function updateCheckin(id: string, patch: CheckinPatch): Promise<Checkin> {
  const { data, error } = await getSupabase().from("checkins").update(patch).eq("id", id).select().single();
  fail(error);
  return data as Checkin;
}

export async function markAllRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await getSupabase().from("checkins").update({ is_read: true }).in("id", ids);
  fail(error);
}

/** Permanently deletes check-ins and their signature images (privacy requests). */
export async function deleteCheckins(rows: Pick<Checkin, "id" | "signature_path">[]): Promise<void> {
  if (!rows.length) return;
  const sb = getSupabase();
  const paths = rows.map((r) => r.signature_path).filter(Boolean);
  if (paths.length) {
    const { error: sErr } = await sb.storage.from("signatures").remove(paths);
    fail(sErr);
  }
  const { error } = await sb
    .from("checkins")
    .delete()
    .in(
      "id",
      rows.map((r) => r.id),
    );
  fail(error);
}

export async function runAutoArchive(): Promise<number> {
  const { data, error } = await getSupabase().rpc("archive_completed_checkins");
  fail(error);
  return Number(data) || 0;
}

/** Signed URL (1 hour) for the private signature image. */
export async function getSignatureUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await getSupabase().storage.from("signatures").createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}

export type LiveStatus = "connecting" | "live" | "reconnecting";

/** Live INSERT/UPDATE/DELETE events. Supabase rejoins dropped channels on its own; we surface the state. */
export function subscribeCheckins(
  l: { onInsert: (c: Checkin) => void; onUpdate: (c: Checkin) => void; onDelete: (id: string) => void },
  onStatus: (s: LiveStatus) => void,
): () => void {
  const sb = getSupabase();
  let wasLive = false;
  const channel = sb
    .channel("checkins-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "checkins" }, (p) => l.onInsert(p.new as Checkin))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "checkins" }, (p) => l.onUpdate(p.new as Checkin))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "checkins" }, (p) => l.onDelete((p.old as { id: string }).id))
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        wasLive = true;
        onStatus("live");
      } else {
        onStatus(wasLive ? "reconnecting" : "connecting");
      }
    });
  return () => {
    sb.removeChannel(channel);
  };
}

/* ------------------------------------------------------------------ */
/* Settings (owner)                                                    */
/* ------------------------------------------------------------------ */

export async function getSettings(): Promise<Settings> {
  const { data, error } = await getSupabase().from("settings").select(SETTINGS_COLUMNS).eq("id", 1).single();
  fail(error);
  return data as unknown as Settings;
}

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const { data, error } = await getSupabase().from("settings").update(patch).eq("id", 1).select(SETTINGS_COLUMNS).single();
  fail(error);
  return data as unknown as Settings;
}

/** Owner dashboards on other devices pick up saved settings through this. */
export function subscribeSettings(cb: (s: Settings) => void): () => void {
  const sb = getSupabase();
  const channel = sb
    .channel("settings-owner")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "settings" }, () => {
      getSettings().then(cb).catch(() => {});
    })
    .subscribe();
  return () => {
    sb.removeChannel(channel);
  };
}

/** bcrypt in the browser; only the hash is sent to the database. */
async function hashPin(pin: string): Promise<string> {
  if (!/^\d{4,6}$/.test(pin)) throw new Error("PIN must be 4–6 digits.");
  // pgcrypto's crypt() reads the $2a$ form; $2a$/$2b$ hashes are identical for inputs this short.
  return (await bcrypt.hash(pin, 10)).replace(/^\$2[by]\$/, "$2a$");
}

/** Owner PIN: dashboard unlock and kiosk exit. */
export async function setPin(pin: string): Promise<void> {
  const { error } = await getSupabase().rpc("set_pin_hash", { new_hash: await hashPin(pin) });
  fail(error);
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === "Invalid login credentials" ? "Incorrect email or password." : error.message);
}

export async function signOut(scope: "local" | "global" = "local"): Promise<void> {
  await getSupabase().auth.signOut({ scope });
}

export async function getOwnerEmail(): Promise<string | null> {
  const { data } = await getSupabase().auth.getUser();
  return data.user?.email ?? null;
}

/** Re-checks the current password without changing the session. */
export async function checkPassword(password: string): Promise<boolean> {
  const email = await getOwnerEmail();
  if (!email) return false;
  const { error } = await getSupabase().auth.signInWithPassword({ email, password });
  return !error;
}

export async function changePassword(current: string, next: string): Promise<void> {
  if (!(await checkPassword(current))) throw new Error("Current password is incorrect.");
  const { error } = await getSupabase().auth.updateUser({ password: next });
  fail(error);
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/login/reset`,
  });
  fail(error);
}

export async function setNewPassword(password: string): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({ password });
  fail(error);
}

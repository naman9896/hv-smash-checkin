"use client";

/**
 * Data access for the whole app (Supabase Postgres, Storage, Realtime, Auth).
 * UI code talks to these functions, never to Supabase directly.
 */
import bcrypt from "bcryptjs";
import { getSupabase, SUPABASE_URL } from "./supabase";
import { DEFAULT_KIOSK_SETTINGS } from "./settings";
import type {
  Checkin,
  CheckinInput,
  CheckinPatch,
  Job,
  JobPatch,
  JobStaffFields,
  KioskSettings,
  Settings,
  SettingsPatch,
  StaffAssignment,
} from "./types";

const SETTINGS_COLUMNS =
  "business_name, owner_name, abn, phone, email, address, opening_hours, logo_path, auto_lock_minutes, kiosk_enabled, " +
  "kiosk_paused_message, kiosk_title, kiosk_subtitle, consent_text, show_year, show_colour, show_odometer, email_required, " +
  "quick_makes, thank_you_reset_seconds, idle_timeout_minutes, sound_enabled, chime, browser_notifications, email_alerts, " +
  "archive_after_months, staff_names, updated_at";

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/* Kiosk (anon)                                                        */
/* ------------------------------------------------------------------ */

/** Create a check-in. Returns only the reference number – the kiosk never reads the table. */
export async function submitCheckin(input: CheckinInput): Promise<{ reference_no: string }> {
  const { data, error } = await getSupabase().rpc("kiosk_submit_checkin", {
    p_id: crypto.randomUUID(),
    p_first_name: input.first_name,
    p_last_name: input.last_name,
    p_phone: input.phone,
    p_email: input.email,
    p_make: input.make,
    p_model: input.model,
    p_year: input.year,
    p_rego: input.rego,
    p_colour: input.colour,
    p_odometer_km: input.odometer_km,
    // Signatures are no longer collected; the column is kept for older check-ins
    p_signature_path: null,
    p_signed_at: new Date().toISOString(),
  });
  fail(error);
  return { reference_no: String(data) };
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

export function logoPublicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${SUPABASE_URL}/storage/v1/object/public/branding/${path.split("/").map(encodeURIComponent).join("/")}`;
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

export async function listByRego(rego: string): Promise<Checkin[]> {
  const { data, error } = await getSupabase()
    .from("checkins")
    .select("*")
    .eq("rego", rego.toUpperCase())
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
    const ors = [`email.ilike.%${safe}%`, `rego.ilike.%${safe.replace(/\s/g, "")}%`, `last_name.ilike.%${safe}%`, `first_name.ilike.%${safe}%`];
    // Phones are stored formatted (0412 345 678): let the spaces fall between any digits.
    if (digits.length >= 6) ors.push(`phone.ilike.%${digits.split("").join("%")}%`);
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
  const paths = rows.map((r) => r.signature_path).filter((p): p is string => !!p);
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
export async function getSignatureUrl(path: string | null): Promise<string | null> {
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

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export async function uploadLogo(file: File): Promise<string> {
  if (!LOGO_TYPES.includes(file.type)) throw new Error("Logo must be a PNG, JPG or SVG file.");
  if (file.size > LOGO_MAX_BYTES) throw new Error("Logo must be 2 MB or smaller.");
  const ext = file.type === "image/svg+xml" ? "svg" : file.type === "image/png" ? "png" : "jpg";
  const path = `logo-${Date.now()}.${ext}`;
  const { error } = await getSupabase().storage.from("branding").upload(path, file, { contentType: file.type, upsert: true });
  fail(error);
  return path;
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

/** Shared staff PIN for the /jobs page. */
export async function setStaffPin(pin: string): Promise<void> {
  const { error } = await getSupabase().rpc("set_staff_pin_hash", { new_hash: await hashPin(pin) });
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

/* ------------------------------------------------------------------ */
/* Jobs – staff (no login, shared staff PIN)                           */
/* ------------------------------------------------------------------ */

/** Checks the staff PIN and returns the employee names. Throws on lockout. */
export async function staffUnlock(pin: string): Promise<{ ok: true; staffNames: string[] } | { ok: false; error: string }> {
  const { data, error } = await getSupabase().rpc("staff_unlock", { pin });
  fail(error);
  const r = data as { ok: boolean; error?: string; staff_names?: string[] };
  return r.ok ? { ok: true, staffNames: r.staff_names ?? [] } : { ok: false, error: r.error ?? "Incorrect PIN" };
}

/** Cars the owner assigned to this mechanic that don't have a job sheet yet. */
export async function staffAssignments(pin: string, employeeName: string): Promise<StaffAssignment[]> {
  const { data, error } = await getSupabase().rpc("staff_assignments", { pin, employee_name: employeeName });
  fail(error);
  const r = data as { ok: boolean; error?: string; items?: StaffAssignment[] };
  if (!r.ok) throw new Error("The staff PIN has changed – please unlock again.");
  return r.items ?? [];
}

/** Staff submit a job sheet (optionally started from an assigned car). Returns the job number. */
export async function staffSubmitJob(pin: string, job: JobStaffFields & { checkin_id?: string | null }): Promise<string> {
  const { data, error } = await getSupabase().rpc("staff_submit_job", { pin, job });
  fail(error);
  if (!data) throw new Error("The staff PIN has changed – please unlock again.");
  return String(data);
}

/* ------------------------------------------------------------------ */
/* Jobs – owner                                                        */
/* ------------------------------------------------------------------ */

export async function listJobs(): Promise<Job[]> {
  const { data, error } = await getSupabase().from("jobs").select("*").order("created_at", { ascending: false }).limit(2000);
  fail(error);
  return data as Job[];
}

export async function getJob(id: string): Promise<Job | null> {
  const { data, error } = await getSupabase().from("jobs").select("*").eq("id", id).maybeSingle();
  fail(error);
  return data as Job | null;
}

export async function createJob(job: JobPatch & JobStaffFields): Promise<Job> {
  const { data, error } = await getSupabase().from("jobs").insert(job).select().single();
  fail(error);
  return data as Job;
}

export async function updateJob(id: string, patch: JobPatch): Promise<Job> {
  const { data, error } = await getSupabase().from("jobs").update(patch).eq("id", id).select().single();
  fail(error);
  return data as Job;
}

export async function deleteJob(id: string): Promise<void> {
  const { error } = await getSupabase().from("jobs").delete().eq("id", id);
  fail(error);
}

export function subscribeJobs(l: { onInsert: (j: Job) => void; onUpdate: (j: Job) => void; onDelete: (id: string) => void }): () => void {
  const sb = getSupabase();
  const channel = sb
    .channel("jobs-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "jobs" }, (p) => l.onInsert(p.new as Job))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "jobs" }, (p) => l.onUpdate(p.new as Job))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "jobs" }, (p) => l.onDelete((p.old as { id: string }).id))
    .subscribe();
  return () => {
    sb.removeChannel(channel);
  };
}

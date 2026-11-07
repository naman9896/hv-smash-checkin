// Supabase Edge Function: emails the owner when a new check-in arrives.
// Triggered by a Database Webhook on INSERT into public.checkins (see README).
// If RESEND_API_KEY is not set it logs the alert instead of sending it.
import { createClient } from "jsr:@supabase/supabase-js@2";

interface CheckinRow {
  reference_no: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  make: string;
  model: string;
  year: number | null;
  rego: string;
  colour: string | null;
  odometer_km: number | null;
  created_at: string;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

Deno.serve(async (req) => {
  // Only the database webhook knows this secret
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  const row = payload?.record as CheckinRow | undefined;
  if (payload?.type !== "INSERT" || !row) return new Response("Ignored", { status: 200 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: settings } = await sb.from("settings").select("email_alerts, email, business_name").eq("id", 1).single();
  if (!settings?.email_alerts || !settings.email) return new Response("Email alerts off", { status: 200 });

  const vehicle = [row.year, row.make, row.model].filter(Boolean).join(" ");
  const subject = `New check-in: ${row.first_name} ${row.last_name} – ${row.rego}`;
  const dashboardUrl = Deno.env.get("DASHBOARD_URL");
  const html = `
    <h2 style="font-family:sans-serif">${esc(subject)}</h2>
    <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Reference</td><td><b>${esc(row.reference_no)}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Customer</td><td>${esc(row.first_name)} ${esc(row.last_name)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Mobile</td><td>${esc(row.phone)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Email</td><td>${esc(row.email || "—")}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Vehicle</td><td>${esc(vehicle)}${row.colour ? ` · ${esc(row.colour)}` : ""}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Rego</td><td><b>${esc(row.rego)}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#64748b">Odometer</td><td>${row.odometer_km != null ? `${row.odometer_km.toLocaleString("en-AU")} km` : "—"}</td></tr>
    </table>
    ${dashboardUrl ? `<p style="font-family:sans-serif"><a href="${esc(dashboardUrl)}">Open the dashboard</a></p>` : ""}`;

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.log(`[notify-checkin] RESEND_API_KEY not set – would email ${settings.email}: ${subject}`);
    return new Response("No email provider configured", { status: 200 });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("ALERT_FROM_EMAIL") ?? `${settings.business_name ?? "Sai Motor Works"} <onboarding@resend.dev>`,
      to: [settings.email],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    console.error("[notify-checkin] Resend error", res.status, await res.text());
    return new Response("Email failed", { status: 502 });
  }
  return new Response("Sent", { status: 200 });
});

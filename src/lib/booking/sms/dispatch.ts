import type { SmsProvider } from "./types";

export const MANAGE_LINK = "{manage_link}";
export const BOOKING_PAGE = "{booking_page}";

/** A row returned by booking_sms_claim. */
export type ClaimedSms = {
  id: string;
  template: string;
  to_mobile: string;
  body: string;
  token: string | null;
  sender_id: string;
  attempts: number;
};

export type DispatchDeps = {
  claim: (limit: number) => Promise<ClaimedSms[]>;
  result: (id: string, ok: boolean, providerId: string | null, error: string | null, retryable: boolean) => Promise<unknown>;
  provider: SmsProvider;
  baseUrl: string;
  limit?: number;
  concurrency?: number;
};

/**
 * Fill links at send time: {manage_link} (tokens never sit in sms_outbox.body) and {booking_page}.
 * null = a manage link is needed but there is no token.
 */
export function renderBody(body: string, token: string | null, baseUrl: string): string | null {
  const out = body.split(BOOKING_PAGE).join(`${baseUrl}/book`);
  if (!out.includes(MANAGE_LINK)) return out;
  if (!token) return null;
  return out.split(MANAGE_LINK).join(`${baseUrl}/b/${token}`);
}

/** Claim due rows, send them, record each result. One bad row never stops the others. */
export async function runDispatch(deps: DispatchDeps): Promise<{ claimed: number; sent: number; failed: number }> {
  const rows = await deps.claim(deps.limit ?? 50);
  let sent = 0;
  let failed = 0;

  async function one(r: ClaimedSms) {
    const body = renderBody(r.body, r.token, deps.baseUrl);
    if (body === null) {
      failed++;
      await deps.result(r.id, false, null, "Manage link missing", false);
      return;
    }
    let outcome;
    try {
      outcome = await deps.provider.send(r.to_mobile, body, r.sender_id);
    } catch {
      console.error(`[booking] SMS provider threw for outbox ${r.id}`); // no mobile, body or error text (may contain PII)
      outcome = { ok: false as const, error: "Provider error", retryable: true };
    }
    if (outcome.ok) {
      sent++;
      await deps.result(r.id, true, outcome.id, null, true);
    } else {
      failed++;
      await deps.result(r.id, false, null, outcome.error, outcome.retryable);
    }
  }

  const queue = [...rows];
  const workers = Array.from({ length: Math.min(deps.concurrency ?? 5, queue.length) }, async () => {
    for (let r = queue.shift(); r; r = queue.shift()) await one(r);
  });
  await Promise.all(workers);
  return { claimed: rows.length, sent, failed };
}

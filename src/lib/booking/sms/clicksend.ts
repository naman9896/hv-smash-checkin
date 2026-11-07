import type { SmsProvider, SmsResult } from "./types";

const ENDPOINT = "https://rest.clicksend.com/v3/sms/send";
const TIMEOUT_MS = 10_000;

type ClickSendResponse = { data?: { messages?: { status?: string; message_id?: string }[] } };

/**
 * ClickSend REST v3 (developers.clicksend.com/docs/messaging/sms/other/send-sms):
 * POST /v3/sms/send, Basic auth username:api_key, { messages: [{ source, from, to, body }] }.
 * Each message carries its own `status` ("SUCCESS" or an error code).
 * Errors returned here never include the mobile or message text.
 */
export function clicksendProvider(opts: { username: string; apiKey: string; fetch?: typeof fetch }): SmsProvider {
  const doFetch = opts.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${opts.username}:${opts.apiKey}`).toString("base64")}`;
  return {
    async send(to, body, senderId): Promise<SmsResult> {
      let res: Response;
      try {
        res = await doFetch(ENDPOINT, {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ source: "sai-motor-checkin", from: senderId, to, body }] }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        return { ok: false, error: "ClickSend network error", retryable: true };
      }
      if (!res.ok) {
        // 429 and 5xx are worth another try; 4xx (bad request, wrong credentials) won't fix themselves
        return { ok: false, error: `ClickSend HTTP ${res.status}`, retryable: res.status === 429 || res.status >= 500 };
      }
      const json = (await res.json().catch(() => null)) as ClickSendResponse | null;
      const msg = json?.data?.messages?.[0];
      if (msg?.status === "SUCCESS" && msg.message_id) return { ok: true, id: msg.message_id };
      const code = (msg?.status ?? "UNKNOWN_RESPONSE").replace(/[^A-Z0-9_]/gi, "").slice(0, 60);
      return { ok: false, error: `ClickSend: ${code}`, retryable: false };
    },
  };
}

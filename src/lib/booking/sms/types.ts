/** API_SPEC §4. `error` must never contain the mobile, the message text or a token. */
export type SmsResult = { ok: true; id: string } | { ok: false; error: string; retryable: boolean };

export interface SmsProvider {
  send(to: string, body: string, senderId: string): Promise<SmsResult>;
}

import { randomUUID } from "node:crypto";
import type { SmsProvider } from "./types";

/** SMS_MODE=log (everything outside production): sends nothing, logs no personal data. */
export const logProvider: SmsProvider = {
  async send(_to, body) {
    const id = `log-${randomUUID()}`;
    console.info(`[sms:log] not sent (log mode): ${body.length} chars, id ${id}`);
    return { ok: true, id };
  },
};

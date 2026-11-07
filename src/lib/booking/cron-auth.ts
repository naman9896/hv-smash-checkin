import { createHash, timingSafeEqual } from "node:crypto";

const MIN_SECRET_LENGTH = 16;

/**
 * Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Constant-time compare (hashes first so
 * lengths match). No secret, or a short one, means every call is refused.
 */
export function isAuthorizedCron(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH || !header) return false;
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

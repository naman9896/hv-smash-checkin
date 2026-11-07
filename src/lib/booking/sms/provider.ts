import { clicksendProvider } from "./clicksend";
import { logProvider } from "./log";
import type { SmsProvider } from "./types";

type Env = Record<string, string | undefined>;

/**
 * Real SMS only when SMS_MODE is exactly "live" in a production build, and on Vercel only in the
 * production environment (preview deployments are production builds too). Everything else logs.
 */
export function resolveSmsMode(env: Env = process.env): "live" | "log" {
  const live = env.SMS_MODE === "live" && env.NODE_ENV === "production" && (env.VERCEL_ENV === undefined || env.VERCEL_ENV === "production");
  return live ? "live" : "log";
}

export class SmsConfigError extends Error {}

export function getSmsProvider(env: Env = process.env): SmsProvider {
  if (resolveSmsMode(env) === "log") return logProvider;
  const username = env.CLICKSEND_USERNAME;
  const apiKey = env.CLICKSEND_API_KEY;
  if (!username || !apiKey) throw new SmsConfigError("SMS_MODE=live but ClickSend credentials are missing.");
  return clicksendProvider({ username, apiKey });
}

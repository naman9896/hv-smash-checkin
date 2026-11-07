// Server wiring for the dispatcher: service-role DB + the provider chosen by SMS_MODE.
import "server-only";
import { logFailure } from "../http";
import { bookingDb, publicBaseUrl } from "../server";
import { runDispatch, type ClaimedSms } from "./dispatch";
import { getSmsProvider } from "./provider";

export async function dispatchDue(limit = 50) {
  const db = bookingDb();
  return runDispatch({
    limit,
    provider: getSmsProvider(),
    baseUrl: publicBaseUrl(),
    claim: async (n) => {
      const { data, error } = await db.rpc("booking_sms_claim", { p_limit: n });
      if (error) throw error;
      return (data ?? []) as ClaimedSms[];
    },
    result: async (id, ok, providerId, err, retryable) => {
      const { error } = await db.rpc("booking_sms_result", {
        p_id: id, p_ok: ok, p_provider_id: providerId, p_error: err, p_retryable: retryable,
      });
      if (error) logFailure("sms result", error);
    },
  });
}

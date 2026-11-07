import "server-only";
import { isAuthorizedCron } from "./cron-auth";
import { logFailure, NO_STORE } from "./http";

/**
 * Wraps a cron route: Bearer CRON_SECRET (constant-time) or 401; no details in errors.
 * Vercel Cron calls these with GET and the Authorization header (vercel.json).
 */
export async function cronRoute(request: Request, label: string, job: () => Promise<unknown>): Promise<Response> {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401, headers: NO_STORE });
  }
  try {
    return Response.json({ ok: true, result: await job() }, { headers: NO_STORE });
  } catch (err) {
    logFailure(`cron ${label}`, err);
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}

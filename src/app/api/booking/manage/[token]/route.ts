import { manageResponse, manageServerError } from "@/lib/booking/manage-http";
import { viewByToken } from "@/lib/booking/manage-server";

/**
 * GET /api/booking/manage/{token} — the booking behind a manage link (API_SPEC §1).
 * 404 for a bad, unknown or expired token. Rate limit: Vercel WAF (T9).
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/booking/manage/[token]">) {
  try {
    return manageResponse(await viewByToken((await ctx.params).token), "manage view");
  } catch (err) {
    return manageServerError("manage view", err);
  }
}

import "server-only";
import { errorResponseFor } from "./errors";
import { logFailure } from "./http";
import { manageErrorMessage } from "./manage";
import type { ManageResult } from "./manage-server";

/** Manage responses: no caching, no referrer (the token is in the URL), not indexed. */
export const MANAGE_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } as const;

function withHeaders(res: Response): Response {
  for (const [k, v] of Object.entries(MANAGE_HEADERS)) res.headers.set(k, v);
  return res;
}

export function manageResponse(r: ManageResult, label: string): Response {
  if (r.ok) return Response.json(r.view, { headers: MANAGE_HEADERS });
  if (r.error.code !== "P0001") logFailure(label, r.error); // business errors aren't logged; never the token
  return withHeaders(errorResponseFor(r.error, manageErrorMessage));
}

export function manageServerError(label: string, err: unknown): Response {
  logFailure(label, err);
  return withHeaders(errorResponseFor({}));
}

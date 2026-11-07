import { describe, expect, it } from "vitest";
import { requireTestTarget } from "../support/env-guard";

// Smoke test: staging is reachable with the test keys.
// Tests must only create rows with unique test emails/phones and clean up only those rows.
const target = requireTestTarget();

describe("staging Supabase", () => {
  it("auth health endpoint answers with the anon key", async () => {
    const res = await fetch(`${target.url}/auth/v1/health`, { headers: { apikey: target.anonKey } });
    expect(res.status).toBe(200);
  });
});

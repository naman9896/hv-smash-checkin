// T3 E2E: cron routes refuse callers without the secret, and work with it (staging, SMS_MODE=log).
import { expect, test } from "@playwright/test";

const ROUTES = ["/api/booking/cron/dispatch", "/api/booking/cron/reminders", "/api/booking/cron/retention"];

test.describe("cron routes", () => {
  for (const path of ROUTES) {
    test(`${path}: 401 without or with a wrong secret`, async ({ request }) => {
      expect((await request.get(path)).status()).toBe(401);
      expect((await request.get(path, { headers: { Authorization: "Bearer wrong-secret-0123456789" } })).status()).toBe(401);
      expect((await request.get(path, { headers: { Authorization: process.env.E2E_CRON_SECRET! } })).status()).toBe(401); // no "Bearer "
    });
  }

  test("work with the secret (desktop only: they act on shared staging data)", async ({ request }, info) => {
    test.skip(info.project.name !== "desktop");
    for (const path of ROUTES) {
      const res = await request.get(path, { headers: { Authorization: `Bearer ${process.env.E2E_CRON_SECRET}` } });
      expect(res.status(), path).toBe(200);
      expect((await res.json()).ok).toBe(true);
    }
  });
});

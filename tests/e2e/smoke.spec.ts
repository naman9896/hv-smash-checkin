import { expect, test } from "@playwright/test";

// Smoke test: the app boots against staging and the home page links to each portal.
test("home page lists the kiosk and dashboard", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.locator('a[href="/kiosk"]').first()).toBeVisible();
  await expect(page.locator('a[href="/dashboard"]').first()).toBeVisible();
});

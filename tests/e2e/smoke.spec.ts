import { expect, test } from "@playwright/test";

// T0 smoke test: the app boots against staging and the home page links to each portal.
test("home page lists the kiosk, job sheet and dashboard", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.locator('a[href="/kiosk"]').first()).toBeVisible();
  await expect(page.locator('a[href="/jobs"]').first()).toBeVisible();
  await expect(page.locator('a[href="/dashboard"]').first()).toBeVisible();
});

// T5 E2E: quick add for a returning customer + send booking link (desktop + phone, staging).
import { expect, test, type Page } from "@playwright/test";
import { addDays, bookingIds, create, randomFarMonday, serviceClient, testMobile, testRego, validInput } from "../db/booking-helpers";

const db = serviceClient();
const mobiles: string[] = [];

test.afterAll(async () => {
  if (!mobiles.length) return;
  const { data } = await db.from("bookings").select("id").in("mobile", mobiles);
  const ids = (data ?? []).map((b) => b.id);
  await db.from("sms_outbox").delete().in("to_mobile", mobiles);
  if (ids.length) await db.from("bookings").delete().in("id", ids);
});

const local = (e164: string) => `0${e164.slice(3, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}`;

async function signIn(page: Page, next: string) {
  const email = process.env.TEST_OWNER_EMAIL;
  const password = process.env.TEST_OWNER_PASSWORD;
  test.skip(!email || !password, "TEST_OWNER_EMAIL / TEST_OWNER_PASSWORD not set");
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/dashboard"));
}

test("quick add: mobile pre-fills a returning customer and their car, then books", async ({ page }) => {
  const mobile = testMobile();
  const rego = testRego();
  mobiles.push(mobile);
  const ids = await bookingIds(db);
  const first = addDays(randomFarMonday(), 1);
  const earlier = await create(db, validInput({ serviceId: ids.services[0].id, windowId: ids.windowId, date: first },
    { mobile, rego, first_name: "Mia", last_name: "Chen", make: "Toyota", model: "Yaris" }), "owner");
  expect(earlier.ok).toBe(true);

  await signIn(page, "/dashboard/bookings/new");
  await expect(page.getByRole("heading", { name: "New booking" })).toBeVisible();

  await page.getByLabel("Mobile").fill(local(mobile));
  await expect(page.getByText("Returning customer")).toBeVisible();
  await expect(page.getByLabel("First name")).toHaveValue("Mia");
  await expect(page.getByLabel("Last name")).toHaveValue("Chen");
  await expect(page.getByLabel("Rego")).toHaveValue(rego); // their only car, picked for them
  await expect(page.getByLabel("Model")).toHaveValue("Yaris");

  await page.getByRole("group", { name: "Services" }).getByRole("button").first().click();
  const date = addDays(first, 7);
  await page.getByLabel("Other date").fill(date);
  await expect(page.getByRole("status").filter({ hasText: "spots left" })).toBeVisible();
  await page.getByRole("button", { name: "Save booking" }).click();

  await page.waitForURL(/\/dashboard\/bookings\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Mia Chen" })).toBeVisible();
  const { data } = await db.from("bookings").select("source, is_read, drop_off_date").eq("mobile", mobile).eq("drop_off_date", date).single();
  expect(data).toEqual({ source: "owner", is_read: true, drop_off_date: date });
});

test("quick add shows what's missing", async ({ page }) => {
  await signIn(page, "/dashboard/bookings/new");
  await page.getByRole("button", { name: "Save booking" }).click();
  await expect(page.getByText("Enter an Australian mobile, e.g. 0412 345 678")).toBeVisible();
  await expect(page.getByText("Choose a day")).toBeVisible();
});

test("send booking link", async ({ page }) => {
  const mobile = testMobile();
  mobiles.push(mobile);
  await signIn(page, "/dashboard/bookings");
  await page.getByRole("button", { name: "Send booking link" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Customer mobile").fill("02 4932 0000");
  await dialog.getByRole("button", { name: "Send link" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Australian mobile");
  await dialog.getByLabel("Customer mobile").fill(local(mobile));
  await dialog.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByText("Booking link sent")).toBeVisible();
  const { data } = await db.from("sms_outbox").select("template, booking_id").eq("to_mobile", mobile);
  expect(data).toEqual([{ template: "booking_link", booking_id: null }]);
});

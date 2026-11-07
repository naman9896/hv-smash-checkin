// T7 E2E: the customer's manage page /b/{token} — view, cancel, change day, after the cutoff,
// bad links, and the no-referrer header. Staging only (playwright.config.ts).
import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { addDays, Created, serviceClient, sydneyToday } from "../db/booking-helpers";
import { formatDayLong } from "../../src/lib/booking/format";

const db = serviceClient();
const created = new Created(db);
test.afterAll(() => created.cleanup());

const today = sydneyToday();
// Scope to <main>: while a streamed page is swapping in, React briefly holds a hidden copy.
const main = (page: Page) => page.getByRole("main");
async function booking(date: string, status = "booked") {
  const id = await created.booking(date, status, { first_name: "Ada", last_name: "Lovelace" });
  return { id, url: `/b/${created.tokenOf(id)}`, token: created.tokenOf(id) };
}

test("shows the booking with minimal details and no-referrer", async ({ page }) => {
  const date = addDays(today, 20);
  const b = await booking(date);
  const res = await page.goto(b.url);
  expect(res!.headers()["referrer-policy"]).toBe("no-referrer");
  expect(res!.headers()["x-robots-tag"]).toContain("noindex");

  await expect(page.getByRole("heading", { name: "Hi Ada" })).toBeVisible();
  await expect(main(page).getByText(formatDayLong(date))).toBeVisible();
  await expect(main(page).getByText("Toyota Corolla")).toBeVisible();
  await expect(main(page).getByText(`until 5pm ${formatDayLong(addDays(date, -1))}`)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Lovelace");
  await expect(page.getByRole("button", { name: "Change day" })).toBeVisible();
});

test("bad links: the page says so, the API returns 404", async ({ page, request }) => {
  await page.goto(`/b/${randomBytes(32).toString("base64url")}`);
  await expect(page.getByRole("heading", { name: "This link isn't valid" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Book a service" })).toHaveAttribute("href", "/book");
  await page.goto("/b/not-a-token");
  await expect(page.getByRole("heading", { name: "This link isn't valid" })).toBeVisible();

  for (const t of [randomBytes(32).toString("base64url"), "not-a-token"]) {
    const res = await request.get(`/api/booking/manage/${t}`);
    expect(res.status()).toBe(404);
    expect(res.headers()["referrer-policy"]).toBe("no-referrer");
    expect((await res.json()).error.code).toBe("NOT_FOUND");
    expect((await request.post(`/api/booking/manage/${t}/cancel`)).status()).toBe(404);
  }
  const b = await booking(addDays(today, 20));
  const unknown = await request.post(`/api/booking/manage/${b.token}/reschedule`, { data: { date: addDays(today, 21), windowId: crypto.randomUUID(), status: "x" } });
  expect(unknown.status()).toBe(400);
  const get = await request.get(`/api/booking/manage/${b.token}`);
  expect(Object.keys(await get.json()).sort()).toEqual([
    "business", "canChange", "changeUntil", "date", "firstName", "make", "model", "referenceNo", "rego", "services", "status", "window",
  ]);
});

test("cancel", async ({ page }) => {
  const b = await booking(addDays(today, 20));
  await page.goto(b.url);
  await page.getByRole("button", { name: "Cancel booking" }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel this booking?" });
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await dialog.getByRole("button", { name: "Yes, cancel" }).click();
  await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Book again" })).toHaveAttribute("href", "/book");
  expect((await db.from("bookings").select("status").eq("id", b.id).single()).data).toEqual({ status: "cancelled" });

  await page.reload(); // the link still shows it, cancelled
  await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change day" })).toHaveCount(0);
});

test("change day, and a full day is refused", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "opens near-future days with overrides: one project only");
  const [from, to, full] = [addDays(today, 10), addDays(today, 11), addDays(today, 12)];
  await created.override({ date: from, is_open: true, capacity_cars: 50 });
  await created.override({ date: to, is_open: true, capacity_cars: 50 });
  await created.override({ date: full, is_open: true, capacity_cars: 1 });
  const b = await booking(from);
  await page.goto(b.url);

  await page.getByRole("button", { name: "Change day" }).click();
  // the day fills up after the list loaded
  await page.getByRole("button", { name: new RegExp(`^${formatDayLong(full)}`) }).click();
  await created.booking(full, "booked");
  await page.getByRole("button", { name: "Move my booking" }).click();
  await expect(main(page).getByText("that day has just filled up")).toBeVisible();

  await page.getByRole("button", { name: new RegExp(`^${formatDayLong(to)}`) }).click();
  await page.getByRole("button", { name: "Move my booking" }).click();
  await expect(main(page).getByText("Booking moved")).toBeVisible();
  await expect(main(page).getByText(formatDayLong(to))).toBeVisible();
  expect((await db.from("bookings").select("drop_off_date").eq("id", b.id).single()).data).toEqual({ drop_off_date: to });
});

test("after the cutoff: no buttons, call us instead (with or without a phone number)", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "changes the shared settings.phone: one project only");
  const b = await booking(today);
  const { data: before } = await db.from("settings").select("phone").eq("id", 1).single();
  try {
    await db.from("settings").update({ phone: null }).eq("id", 1);
    await page.goto(b.url);
    await expect(main(page).getByText("too late to change this booking online. Please give the workshop a call.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Call/ })).toHaveCount(0);

    await db.from("settings").update({ phone: "1300 017 205" }).eq("id", 1);
    await page.reload();
    await expect(main(page).getByText("too late to change this booking online. Please call us on 1300 017 205.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Call 1300 017 205" })).toHaveAttribute("href", "tel:1300017205");
  } finally {
    await db.from("settings").update({ phone: before?.phone ?? null }).eq("id", 1);
  }
  await expect(page.getByRole("button", { name: "Cancel booking" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change day" })).toHaveCount(0);
});

// T4 E2E: the owner's Bookings tab on staging (desktop + phone). Each test makes its own booking
// on a random far-future Tuesday through booking_create and deletes it afterwards.
import { expect, test, type Page } from "@playwright/test";
import { addDays, bookingIds, create, randomFarMonday, serviceClient, validInput } from "../db/booking-helpers";
import { formatDay } from "../../src/lib/booking/format";

const db = serviceClient();
const made: string[] = [];

test.afterAll(async () => {
  if (!made.length) return;
  await db.from("sms_outbox").delete().in("booking_id", made);
  await db.from("bookings").delete().in("id", made);
});

async function newBooking() {
  const ids = await bookingIds(db);
  const date = addDays(randomFarMonday(), 1);
  const input = validInput({ serviceId: ids.services[0].id, windowId: ids.windowId, date }, { first_name: "Playwright", last_name: "Owner" });
  const r = await create(db, input, "owner"); // far dates are outside the online horizon
  if (!r.ok) throw new Error(`create: ${r.code}`);
  made.push(r.data.id);
  return { ...r.data, rego: input.rego };
}

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

test("signed out: /dashboard/bookings goes to the login page", async ({ page }) => {
  await page.goto("/dashboard/bookings");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fbookings/);
});

test("owner: day view → detail → arrived, undo, notes, reschedule, cancel", async ({ page }) => {
  const b = await newBooking();
  await signIn(page, `/dashboard/bookings?date=${b.date}`);

  // Day view lists it
  await expect(page.getByRole("heading", { name: "Bookings", exact: true })).toBeVisible();
  const row = page.getByRole("link", { name: new RegExp(b.rego) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Booked");
  await row.click();

  // Detail
  await expect(page.getByRole("heading", { name: "Playwright Owner" })).toBeVisible();
  await expect(page.getByText(b.reference_no)).toBeVisible();
  await expect(page.getByText("Confirmation", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Mark arrived" }).click();
  await expect(page.getByRole("button", { name: "Undo arrived" })).toBeVisible();
  await page.getByRole("button", { name: "Undo arrived" }).click();
  await expect(page.getByRole("button", { name: "Mark arrived" })).toBeVisible();

  await page.getByLabel("Your notes").fill("Customer wants a call before extra work");
  await page.getByRole("button", { name: "Save notes" }).click();
  await expect(page.getByText("Notes saved")).toBeVisible();

  // Reschedule a week later, texting the customer
  const to = addDays(b.date, 7);
  await page.getByRole("button", { name: "Reschedule" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New drop-off day").fill(to);
  await expect(dialog.getByRole("status")).toContainText("spots left");
  await dialog.getByRole("button", { name: "Move booking" }).click();
  await expect(page.getByText(`Moved to ${formatDay(to)}`)).toBeVisible();
  await expect(page.getByText("New date", { exact: true })).toBeVisible();

  // Cancel, texting the customer
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByText("Booking cancelled")).toBeVisible();
  await expect(page.getByRole("button", { name: "Re-open booking" })).toBeVisible();
  await expect(page.getByText("Cancellation", { exact: true })).toBeVisible();

  const { data } = await db.from("bookings").select("status, drop_off_date, owner_notes").eq("id", b.id).single();
  expect(data).toEqual({ status: "cancelled", drop_off_date: to, owner_notes: "Customer wants a call before extra work" });
});

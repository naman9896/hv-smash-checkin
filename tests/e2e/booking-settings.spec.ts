// T8 E2E: Settings → Online Booking, and no-show counts on the day list. These change shared
// staging settings, so they run once (desktop), in order, and put everything back.
import { expect, test, type Page } from "@playwright/test";
import { addDays, Created, randomFarMonday, serviceClient, testMobile } from "../db/booking-helpers";

const db = serviceClient();
const created = new Created(db);
let savedSettings: Record<string, unknown>;

test.describe.configure({ mode: "serial" });
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "changes shared settings: desktop only"));
test.beforeAll(async () => {
  savedSettings = (await db.from("booking_settings").select("*").eq("id", 1).single()).data!;
});
test.afterAll(async () => {
  const rest = { ...savedSettings };
  delete rest.id;
  delete rest.updated_at;
  await db.from("booking_settings").update(rest).eq("id", 1);
  await created.cleanup();
});

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
async function openTab(page: Page) {
  await signIn(page, "/dashboard/settings#booking");
  await page.getByRole("tab", { name: "Online Booking" }).click();
  await expect(page.getByRole("heading", { name: "Text messages" })).toBeVisible();
}

test("sender ID is checked, then saved", async ({ page }) => {
  await openTab(page);
  const sender = page.getByLabel("Sender name");
  await sender.fill("Sai Motor");
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Text messages" }) });
  await card.getByRole("button", { name: "Save changes" }).click();
  await expect(card.getByText("Up to 11 letters and numbers, no spaces")).toBeVisible();

  await sender.fill("SaiMotorE2E");
  await card.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Online booking settings saved")).toBeVisible();
  expect((await db.from("booking_settings").select("sms_sender_id").eq("id", 1).single()).data).toEqual({ sms_sender_id: "SaiMotorE2E" });
});

test("opening Sunday needs a number of cars", async ({ page }) => {
  await openTab(page);
  const sunday = page.getByRole("group", { name: "Sunday" });
  await sunday.getByRole("switch", { name: "Open" }).click();
  await sunday.getByLabel("Cars").fill("0");
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Weekly hours" }) });
  await card.getByRole("button", { name: "Save changes" }).click();
  await expect(sunday.getByText(/How many cars/)).toBeVisible();
  expect((await db.from("booking_weekly_hours").select("is_open").eq("weekday", 7).single()).data).toEqual({ is_open: false });
});

test("closing a date that has bookings lists them first", async ({ page }) => {
  const date = addDays(randomFarMonday(), 2);
  const id = await created.booking(date, "booked", { first_name: "Mia", last_name: "Closedday" });
  created.overrides.push(date);
  await openTab(page);

  const card = page.locator("section", { has: page.getByRole("heading", { name: "Closed and special dates" }) });
  await card.getByLabel("Date", { exact: true }).fill(date);
  await card.getByLabel("Reason (only you see this)").fill("Staff training");
  await card.getByRole("switch", { name: "Show my phone number to customers" }).click();
  await card.getByRole("button", { name: "Save date" }).click();

  const warning = card.getByRole("alert");
  await expect(warning).toContainText("1 booking on this day");
  await expect(warning.getByRole("link", { name: /Mia Closedday/ })).toHaveAttribute("href", `/dashboard/bookings/${id}`);
  await card.getByRole("button", { name: "Close the day anyway" }).click();

  await expect(card.getByRole("listitem").filter({ hasText: "Staff training" })).toBeVisible();
  expect((await db.from("booking_date_overrides").select("is_open, reason, show_phone").eq("date", date).single()).data)
    .toEqual({ is_open: false, reason: "Staff training", show_phone: true });

  await card.getByRole("listitem").filter({ hasText: "Staff training" }).getByRole("button", { name: /Remove/ }).click();
  await expect(card.getByRole("listitem").filter({ hasText: "Staff training" })).toHaveCount(0);
  expect((await db.from("booking_date_overrides").select("date").eq("date", date)).data).toEqual([]);
});

test("the day list shows earlier no-shows for the mobile", async ({ page }) => {
  const mobile = testMobile();
  const date = addDays(randomFarMonday(), 2);
  await created.booking(addDays(date, -14), "no_show", { mobile });
  await created.booking(date, "booked", { mobile, first_name: "Noah", last_name: "Shows" });
  await signIn(page, `/dashboard/bookings?date=${date}`);
  const row = page.getByRole("listitem").filter({ hasText: "Noah Shows" });
  await expect(row.getByText("1 no-show")).toBeVisible();
});

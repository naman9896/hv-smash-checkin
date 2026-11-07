// T6 E2E: the check-in drawer shows the linked booking and sends the ready SMS (walk-ins too).
import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { anonClient, Created, serviceClient, sydneyToday, testMobile } from "../db/booking-helpers";

const db = serviceClient();
const anon = anonClient();
const created = new Created(db);
const checkins: string[] = [];

test.afterAll(async () => {
  if (checkins.length) await db.from("sms_outbox").delete().in("checkin_id", checkins);
  await created.cleanup();
  if (checkins.length) await db.from("checkins").delete().in("id", checkins);
});

const kioskRego = () => `Q${randomBytes(4).toString("hex").toUpperCase().slice(0, 6)}`;

async function kiosk(rego: string, phone: string): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await anon.rpc("kiosk_submit_checkin", {
    p_id: id, p_first_name: "Drawer", p_last_name: "Test", p_phone: phone, p_email: "drawer@example.com", p_make: "Honda",
    p_model: "Jazz", p_year: null, p_rego: rego, p_colour: null, p_odometer_km: null, p_signature_path: null,
    p_signed_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  checkins.push(id);
  return id;
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

test("walk-in: send the ready SMS, and a second press asks first", async ({ page }) => {
  const mobile = testMobile();
  const id = await kiosk(kioskRego(), `0${mobile.slice(3)}`);
  await signIn(page, `/dashboard/${id}`);

  await expect(page.getByText("Walk-in: no booking.")).toBeVisible();
  await page.getByRole("button", { name: "Send ready SMS" }).click();
  await expect(page.getByText("Ready text queued")).toBeVisible();

  await page.getByRole("button", { name: "Send ready SMS" }).click();
  const dialog = page.getByRole("dialog", { name: "Send again?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Don't send" }).click();
  await expect(dialog).toBeHidden();
  const { data } = await db.from("sms_outbox").select("to_mobile").eq("checkin_id", id);
  expect(data).toEqual([{ to_mobile: mobile }]);
});

test("walk-in with a landline: button disabled, 'Not a mobile number'", async ({ page }) => {
  const id = await kiosk(kioskRego(), "02 4932 0000");
  await signIn(page, `/dashboard/${id}`);
  await expect(page.getByText("Not a mobile number")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send ready SMS" })).toBeDisabled();
});

test("kiosk check-in that matches today's booking shows the booking", async ({ page }) => {
  const rego = kioskRego();
  const bookingId = await created.booking(sydneyToday(), "booked", { rego });
  const id = await kiosk(rego, "0400 000 000");
  await signIn(page, `/dashboard/${id}`);
  const badge = page.getByRole("link", { name: /Booked online/ });
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("Arrived");
  await badge.click();
  await page.waitForURL(`**/dashboard/bookings/${bookingId}`);
  await expect(page.getByRole("button", { name: "Send ready SMS" })).toBeVisible();
});

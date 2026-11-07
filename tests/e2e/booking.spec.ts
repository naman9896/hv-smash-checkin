// T2 E2E: public booking API + /book happy path on a phone. Runs against STAGING only (playwright.config.ts).
import { expect, test } from "@playwright/test";
import { serviceClient, testRego } from "../db/booking-helpers";

const db = serviceClient();
const regos: string[] = [];

test.afterAll(async () => {
  if (!regos.length) return;
  const { data } = await db.from("bookings").select("id").in("rego", regos);
  const ids = (data ?? []).map((b) => b.id);
  if (ids.length) {
    await db.from("sms_outbox").delete().in("booking_id", ids);
    await db.from("bookings").delete().in("id", ids);
  }
});

const randomMobile = () => `04${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

test.describe("booking API", () => {
  test("GET /api/booking/info returns the public details only", async ({ request }) => {
    const res = await request.get("/api/booking/info");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(body.services.map((s: { name: string }) => s.name)).toContain("Basic service");
    expect(body.windows).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/pin_hash|staff|abn|sender/i);
  });

  test("GET /api/booking/availability returns date + status only, max 31 days", async ({ request }) => {
    const ok = await request.get("/api/booking/availability?from=2031-01-06&to=2031-01-12");
    expect(ok.status()).toBe(200);
    const { days } = await ok.json();
    expect(days).toHaveLength(7);
    for (const d of days) expect(Object.keys(d).sort()).toEqual(["callUs", "date", "fewLeft", "status"]);

    expect((await request.get("/api/booking/availability?from=2031-01-01&to=2031-02-15")).status()).toBe(400);
    expect((await request.get("/api/booking/availability?from=2031-01-01")).status()).toBe(400);
    expect((await request.get("/api/booking/availability?from=2031-01-01&to=2031-01-02&x=1")).status()).toBe(400);
  });

  test("POST /api/booking rejects unknown fields and bad JSON", async ({ request }) => {
    const unknown = await request.post("/api/booking", { data: { isAdmin: true } });
    expect(unknown.status()).toBe(400);
    expect((await unknown.json()).error.code).toBe("VALIDATION");

    const bad = await request.post("/api/booking", { data: "{not json", headers: { "content-type": "application/json" } });
    expect(bad.status()).toBe(400);
  });
});

test.describe("/book", () => {
  test("happy path on a phone", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "the happy path books a real (staging) slot: phone only");
    const rego = testRego();
    regos.push(rego);

    await page.goto("/book");
    await expect(page.getByRole("heading", { name: "What do you need?" })).toBeVisible();

    // Can't continue without a service
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Please choose at least one service")).toBeVisible();
    await page.getByRole("checkbox", { name: /Basic service/ }).check();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Pick a drop-off day" })).toBeVisible();
    await page.locator('[data-status="open"]').first().click();
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Your vehicle" })).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Please enter the registration")).toBeVisible();
    await page.getByLabel("Registration").fill(rego);
    await page.getByLabel("Make").selectOption("Toyota");
    await page.getByLabel("Model").fill("Corolla");
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
    await page.getByLabel("First name").fill("Playwright");
    await page.getByLabel("Last name").fill("Test");
    await page.getByLabel("Mobile").fill("02 4932 1234");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Enter an Australian mobile, e.g. 0412 345 678")).toBeVisible();
    await page.getByLabel("Mobile").fill(randomMobile());
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Anything we should know?" })).toBeVisible();
    await page.getByLabel("Anything we should know?").fill("E2E test booking");
    await page.getByRole("button", { name: "Next", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Check and book" })).toBeVisible();
    await expect(page.getByText(rego)).toBeVisible();
    await expect(page.getByText("Basic service")).toBeVisible();
    await page.getByRole("button", { name: "Book", exact: true }).click();

    await expect(page.getByRole("heading", { name: "You're booked in" })).toBeVisible();
    await expect(page.getByText(/BKG-\d+/)).toBeVisible();
    await expect(page.getByText("drop off 8:30–9:30am", { exact: false })).toBeVisible();

    // T7: the confirmation links to the manage page
    const manage = page.getByRole("link", { name: "Change or cancel" });
    await expect(manage).toHaveAttribute("href", /\/b\/[A-Za-z0-9_-]{43}$/);
    await manage.click();
    await expect(page.getByRole("heading", { name: "Hi Playwright" })).toBeVisible();
    await expect(page.getByRole("main").getByText(rego)).toBeVisible();

    const { data } = await db.from("bookings").select("status, source, customer_notes").eq("rego", rego).single();
    expect(data).toEqual({ status: "booked", source: "online", customer_notes: "E2E test booking" });
  });
});

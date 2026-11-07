import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { requireTestTarget } from "./tests/support/env-guard";

// Refuse to start (and so never boot the app) unless the TEST_* vars point at staging.
const target = requireTestTarget();

// A fresh secret per run, so the E2E cron tests can call the cron routes (staging, SMS_MODE=log).
export const E2E_CRON_SECRET = process.env.E2E_CRON_SECRET ??= `e2e-${randomUUID()}`;

const PORT = 3100; // not 3000: never reuse a dev server that may be pointed at production
const baseURL = `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // CI tests a production build (as the Next docs recommend); locally a dev server is quicker.
    command: isCI ? `npm run build && npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      // NODE_ENV=test makes Next skip .env.local (the production keys) entirely.
      NODE_ENV: "test",
      NEXT_PUBLIC_SUPABASE_URL: target.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: target.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: target.serviceRoleKey,
      SMS_MODE: "log",
      CRON_SECRET: E2E_CRON_SECRET,
      PUBLIC_BASE_URL: baseURL,
    },
  },
});

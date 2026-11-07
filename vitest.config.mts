import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Two projects:
// - unit: pure code, no network, no secrets. Runs in CI on both repos (`npm test`).
// - db:   integration tests against the STAGING Supabase project (`npm run test:db`).
//         The global setup refuses to run against production (tests/support/env-guard.ts).
export default defineConfig({
  resolve: {
    alias: {
      "@config": fileURLToPath(new URL("./config", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          globalSetup: ["tests/db/global-setup.ts"],
          // DB tests share one staging database: run files one at a time.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});

import { defineConfig, devices } from "@playwright/test";

const PROD_URL = "https://web-iota-nine-pbfle4mkic.vercel.app";
const baseURL = process.env.E2E_BASE_URL || PROD_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "smoke",  testMatch: /smoke\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "setup",  testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
    {
      name: "authed",
      testMatch: /.*(?<!\.setup)\.spec\.ts/,
      testIgnore: /smoke\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "tests/.auth/user.json" },
    },
  ],
});

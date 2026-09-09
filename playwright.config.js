import { defineConfig, devices } from "@playwright/test";

/* The app is frontend-only, so the e2e suite runs against the production
   build with no services behind it — which is also how a reviewer will try
   it. Chromium is pre-installed in this environment; PLAYWRIGHT_CHROMIUM
   lets CI point at its own binary. */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions: executablePath ? { executablePath } : {} } },
    { name: "mobile", use: { ...devices["Pixel 5"], launchOptions: executablePath ? { executablePath } : {} } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

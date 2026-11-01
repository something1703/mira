import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const WORKFLOWS_PORT = Number(process.env.E2E_WORKFLOWS_PORT ?? 4120);

/** Playwright always runs against mock mode (docs/TESTING.md). */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-light", use: { ...devices["Desktop Chrome"], colorScheme: "light" } },
    { name: "desktop-dark", use: { ...devices["Desktop Chrome"], colorScheme: "dark" } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: `pnpm exec next dev --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        MIRA_MODE: "mock",
        NEXT_PUBLIC_MIRA_MODE: "mock",
        MIRA_WORKFLOWS_URL: `http://localhost:${WORKFLOWS_PORT}`,
      },
    },
    {
      // The run viewer reads mira-workflows; it runs in mock mode with a synthetic YouCam.
      command: "pnpm --filter @mira/workflows exec tsx src/main.ts",
      url: `http://localhost:${WORKFLOWS_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // A small session cap so one demo run (40 units) brings the "units left" banner up.
      env: { MIRA_MODE: "mock", PORT: String(WORKFLOWS_PORT), MIRA_SESSION_UNIT_CAP: "45" },
    },
  ],
});

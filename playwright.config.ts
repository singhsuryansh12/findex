import { defineConfig, devices } from "@playwright/test";

const browserTestPort = 3_107;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${browserTestPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${browserTestPort}`,
    url: `http://127.0.0.1:${browserTestPort}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { OPENAI_API_KEY: "", WORKSPACE_EXECUTION_MODE: "disabled" },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
});

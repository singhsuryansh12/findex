import { defineConfig } from "@playwright/test";

const port = Number(process.env.WORKSPACE_PREVIEW_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: "workspace.e2e.ts",
  timeout: 90_000,
  workers: 1,
  use: { baseURL, browserName: "chromium" },
  webServer: {
    command: "npm run preview",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 15_000,
  },
});

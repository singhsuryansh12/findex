import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const baseURL = process.env.DEMO_URL ?? "http://localhost:3000";

async function capture(name: string, viewport: { width: number; height: number }, mobile = false) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(() => window.sessionStorage.setItem("findex-demo-entered-v1", "true"));
  await page.goto(`${baseURL}/demo/brain`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Your money, your tools." }).waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `public/${name}.png`, fullPage: false });
  await context.close();
}

await capture("dashboard-desktop", { width: 1440, height: 1000 });
await capture("dashboard-mobile", { width: 390, height: 844 }, true);
await browser.close();

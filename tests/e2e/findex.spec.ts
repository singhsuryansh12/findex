import { expect, test } from "@playwright/test";

async function enterDemo(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Money,/ })).toBeVisible();
  await page.getByRole("button", { name: "Login as Demo User" }).click();
  await expect(page.getByRole("heading", { name: /Morning, Jordan/ })).toBeVisible();
}

test("demo login reaches the populated predictive dashboard", async ({ page }) => {
  await enterDemo(page);
  await expect(page.getByText("Safe to spend", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$7,309")).toBeVisible();
  await expect(page.getByLabel("Thirty day projected balance and safe-to-spend chart")).toBeVisible();
  await expect(page.getByText("Latest transactions")).toBeVisible();
  await expect(page.getByText("Coming up")).toBeVisible();
});

test("Financial Brain streams the exact grounded dining answer", async ({ page }, testInfo) => {
  await enterDemo(page);
  if (testInfo.project.name === "mobile-390") await page.getByRole("button", { name: "Ask FinDex" }).click();
  const input = page.getByLabel("Message the Financial Brain");
  await input.fill("How much did I spend on dining out last month?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText("$366.21");
  await expect(page.locator(".provenance-chip").last()).toContainText("8 Dining transactions · Jun 1–30");
});

test("fixture-backed Codex artifact inserts without navigation and survives reload", async ({ page }, testInfo) => {
  await enterDemo(page);
  if (testInfo.project.name === "mobile-390") await page.getByRole("button", { name: "Ask FinDex" }).click();
  const originalUrl = page.url();
  await page.getByLabel("Message the Financial Brain").fill("Build me a FIRE calculator");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Verified sample · live generation unavailable")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".generated-preview iframe")).toBeAttached();
  const preview = page.frameLocator(".generated-preview iframe");
  await expect(preview.getByRole("heading", { name: "FIRE runway" })).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByText("Projected at retirement")).toBeVisible();
  await expect(preview.locator("body")).not.toContainText("Could not find dependency");
  const monthlyContribution = preview.locator('input[type="range"]').first();
  await expect(monthlyContribution).toBeVisible();
  await monthlyContribution.fill("2500");
  await expect(monthlyContribution).toHaveValue("2500");
  expect(page.url()).toBe(originalUrl);
  await page.reload();
  await expect(page.getByText("Verified sample · live generation unavailable")).toBeVisible();
});

test("layout contains horizontal detail overflow at 390px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "Mobile-only layout assertion");
  await enterDemo(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
});

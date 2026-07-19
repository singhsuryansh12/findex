import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";

type WorkspacePlan = { inputs: Array<{ label: string }>; outputs: Array<{ label: string }> };
const plan = JSON.parse(await readFile("workspace-plan.json", "utf8")) as WorkspacePlan;

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function observableOutput(page: Page) {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, select, textarea, button").forEach((element) => element.remove());
    return clone.innerHTML;
  });
}

async function plannedControl(page: Page, label: string) {
  const control = page.getByLabel(label, { exact: true }).first();
  if (await control.isVisible()) return control;
  const tabs = page.getByRole("tab");
  for (let index = 0; index < await tabs.count(); index += 1) {
    await tabs.nth(index).click();
    if (await control.isVisible()) return control;
  }
  await expect(control).toBeVisible();
  return control;
}

async function assertPlannedOutput(page: Page, label: string) {
  const output = page.getByLabel(label, { exact: true }).or(page.getByText(label, { exact: true })).first();
  if (await output.isVisible()) return;
  const tabs = page.getByRole("tab");
  for (let index = 0; index < await tabs.count(); index += 1) {
    await tabs.nth(index).click();
    if (await output.isVisible()) return;
  }
  await expect(output).toBeVisible();
}

async function changeControl(control: Locator) {
  const tag = await control.evaluate((element) => element.tagName.toLowerCase());
  const inputType = await control.getAttribute("type");
  if (tag === "select") {
    const current = await control.inputValue();
    const values = await control.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    const next = values.find((value) => value !== current);
    if (!next) throw new Error("A requested select input has no alternative value.");
    await control.selectOption(next);
  } else if (tag === "textarea" || (tag === "input" && !["checkbox", "radio", "range"].includes(inputType ?? ""))) {
    const current = await control.inputValue();
    const next = inputType === "number" ? String((Number(current) || 0) + 137) : `${current} verification`;
    await control.fill(next);
  } else if (inputType === "checkbox") {
    await control.click();
  } else if (inputType === "radio") {
    if (await control.isChecked()) throw new Error("A requested radio input must expose an independently changeable label.");
    await control.check();
  } else if (inputType === "range") {
    const current = Number(await control.inputValue());
    const min = Number(await control.getAttribute("min") ?? 0);
    const max = Number(await control.getAttribute("max") ?? 100);
    await control.fill(String(current === max ? min : max));
  } else {
    await control.click();
  }
}

test("renders, exercises controls, and remains responsive", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
  await expect(page.locator("h1, h2").first()).toBeVisible();
  for (const output of plan.outputs) await assertPlannedOutput(page, output.label);

  for (const input of plan.inputs) {
    const control = await plannedControl(page, input.label);
    const before = await observableOutput(page);
    await changeControl(control);
    await expect.poll(() => observableOutput(page)).not.toBe(before);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await assertNoOverflow(page);
  await page.screenshot({ path: "test-results/workspace-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertNoOverflow(page);
  await page.screenshot({ path: "test-results/workspace-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

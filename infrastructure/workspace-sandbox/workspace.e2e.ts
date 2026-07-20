import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

type WorkspacePlanInput = {
  label: string;
  description: string;
  type: "number" | "currency" | "percentage" | "text" | "select" | "date" | "boolean";
  required: boolean;
  defaultValue: string;
  min?: string;
  max?: string;
  step?: string;
};
type WorkspacePlan = {
  inputs: WorkspacePlanInput[];
  outputs: Array<{ label: string }>;
  persistence?: { enabled: boolean };
};
const plan = JSON.parse(await readFile("workspace-plan.json", "utf8")) as WorkspacePlan;

const labelStopWords = new Set([
  "a", "an", "at", "in", "investment", "money", "of", "optional", "projected", "required", "selected", "the", "to", "your",
]);

function labelTokens(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/'s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !labelStopWords.has(token));
}

function labelsMatch(planned: string, rendered: string) {
  const expected = labelTokens(planned);
  const actual = labelTokens(rendered);
  if (!expected.length || !actual.length) return false;
  if (expected.join(" ") === actual.join(" ")) return true;
  // Prefer verbatim coverage: every planned content token appears in the rendered label.
  if (expected.every((token) => actual.includes(token))) return true;
  const overlap = expected.filter((token) => actual.includes(token)).length;
  return overlap >= 2
    && overlap / Math.min(expected.length, actual.length) >= 0.8
    && overlap / Math.max(expected.length, actual.length) >= 0.6;
}

function idSelector(id: string) {
  return `[id=${JSON.stringify(id)}]`;
}

async function assertNoOverflow(page: Page) {
  // Responsive chart libraries commonly resize on the next ResizeObserver
  // delivery. Poll long enough for that layout pass, but still reject any
  // persistent document-level horizontal overflow.
  await expect.poll(
    () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    { timeout: 5_000 },
  ).toBeLessThanOrEqual(1);
}

async function observableOutput(page: Page) {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea, button, [aria-live], [role="status"], [role="alert"]').forEach((element) => element.remove());
    return clone.innerHTML;
  });
}

async function visiblePlannedControl(page: Page, label: string) {
  const controls = page.locator("input, select, textarea");
  const count = await controls.count();
  // Cap the scan so a pathological DOM cannot burn the whole Playwright budget.
  for (let index = 0; index < Math.min(count, 40); index += 1) {
    const control = controls.nth(index);
    if (!await control.isVisible()) continue;
    const renderedLabels = await control.evaluate((element) => {
      const labelledBy = element.getAttribute("aria-labelledby")
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ") ?? "";
      const nativeLabels = "labels" in element
        ? Array.from((element as HTMLInputElement).labels ?? []).map((item) => item.textContent ?? "").join(" ")
        : "";
      return [element.getAttribute("aria-label") ?? "", labelledBy, nativeLabels].filter(Boolean);
    });
    if (renderedLabels.some((rendered) => labelsMatch(label, rendered))) return control;
  }
  return null;
}

async function plannedControl(page: Page, label: string) {
  let control = await visiblePlannedControl(page, label);
  if (control) return control;
  const tabs = page.getByRole("tab");
  for (let index = 0; index < await tabs.count(); index += 1) {
    await tabs.nth(index).click();
    control = await visiblePlannedControl(page, label);
    if (control) return control;
  }
  return null;
}

async function visiblePlannedOutput(page: Page, label: string) {
  const candidates = page.locator("[aria-label], h1, h2, h3, h4, p, dt, th, label, span, strong");
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible()) continue;
    const renderedLabels = await candidate.evaluate((element) => [
      element.getAttribute("aria-label") ?? "",
      element.textContent?.trim() ?? "",
    ].filter((value) => value && value.length <= 180));
    if (renderedLabels.some((rendered) => labelsMatch(label, rendered))) return candidate;
  }
  return null;
}

async function plannedOutput(page: Page, label: string) {
  let output = await visiblePlannedOutput(page, label);
  if (output) return output;
  const tabs = page.getByRole("tab");
  for (let index = 0; index < await tabs.count(); index += 1) {
    await tabs.nth(index).click();
    output = await visiblePlannedOutput(page, label);
    if (output) return output;
  }
  return null;
}

async function changeControl(control: Locator, preferBoundary = false) {
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
    const requestedStep = Number(await control.getAttribute("step"));
    const step = Number.isFinite(requestedStep) && requestedStep > 0 ? requestedStep : 1;
    const numericValue = Number(current);
    const minimum = Number(await control.getAttribute("min"));
    const maximum = Number(await control.getAttribute("max"));
    const incremented = (Number.isFinite(numericValue) ? numericValue : 0) + step;
    const boundary = Number.isFinite(minimum) && minimum !== numericValue
      ? minimum
      : Number.isFinite(maximum) && maximum !== numericValue
        ? maximum
        : incremented;
    const nextNumber = preferBoundary
      ? boundary
      : Number.isFinite(maximum) && incremented > maximum
        ? (Number.isFinite(numericValue) ? numericValue : 0) - step
        : incremented;
    const next = inputType === "number" ? String(nextNumber) : `${current} verification`;
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

async function accessibleControlText(control: Locator) {
  return control.evaluate((element) => {
    const visibleText = (source: Element | null) => {
      if (!source) return "";
      const clone = source.cloneNode(true) as Element;
      clone.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
      return clone.textContent ?? "";
    };
    const idsText = (attribute: "aria-labelledby" | "aria-describedby") => (element.getAttribute(attribute) ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => visibleText(document.getElementById(id)))
      .join(" ");
    const nativeLabels = "labels" in element
      ? Array.from((element as HTMLInputElement).labels ?? []).map((label) => visibleText(label)).join(" ")
      : "";
    return [
      element.getAttribute("aria-label") ?? "",
      idsText("aria-labelledby"),
      nativeLabels,
      idsText("aria-describedby"),
      element.getAttribute("title") ?? "",
    ].join(" ").replace(/\s+/g, " ").trim();
  });
}

function requiredUnitPattern(input: WorkspacePlanInput) {
  if (input.type === "percentage") return /%|percent(?:age)?/i;
  if (input.type === "currency") return /[$€£₹¥₩₽]|\b(?:currency|dollars?|usd|rupees?|inr|euros?|eur|pounds?|gbp|yen|jpy|won|krw)\b/i;
  const context = `${input.label} ${input.description}`;
  if (/\b(?:horizon|year|term)\b/i.test(context)) return /\b(?:years?|months?)\b/i;
  if (/\bage\b/i.test(context)) return /\b(?:age|years?)\b/i;
  return null;
}

function requiresWholeUnits(input: WorkspacePlanInput, step: number) {
  if (input.type !== "number" || !Number.isInteger(step)) return false;
  return /\b(?:age|ages)\b/i.test(`${input.label} ${input.description}`);
}

async function validateWholeUnitStepHandling(page: Page) {
  const diagnostics: string[] = [];
  const candidates = plan.inputs.filter((input) => input.type === "number");
  for (let index = 0; index < candidates.length; index += 1) {
    if (index > 0) {
      await page.reload();
      await expect(page.locator("h1, h2").first()).toBeVisible();
    }
    const input = candidates[index];
    const control = await plannedControl(page, input.label);
    if (!control || await control.getAttribute("type") !== "number") continue;
    const min = Number(await control.getAttribute("min"));
    const max = Number(await control.getAttribute("max"));
    const step = Number(await control.getAttribute("step"));
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0 || !requiresWholeUnits(input, step)) continue;
    const fractional = min + step / 2;
    if (fractional >= max) continue;
    await control.fill(String(fractional));
    await control.blur();
    const state = await control.evaluate((element) => {
      const field = element as HTMLInputElement;
      return {
        ariaInvalid: field.getAttribute("aria-invalid"),
        stepMismatch: field.validity.stepMismatch,
        value: field.value,
      };
    });
    // A controlled input may normalize an off-step value. If it preserves the
    // browser-invalid value, the application must surface that invalid state
    // itself so calculations cannot silently truncate fractional ages/terms.
    if (!state.stepMismatch) continue;
    const describedBy = (await control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    const describedText = describedBy.length
      ? await page.locator(describedBy.map(idSelector).join(",")).allTextContents()
      : [];
    if (state.ariaInvalid !== "true" || !describedText.join(" ").trim()) {
      diagnostics.push(
        `${input.label}: off-step value '${state.value}' must be normalized or exposed as invalid with an associated message; `
        + `whole-unit ages must not be silently truncated in financial calculations.`,
      );
    }
  }
  if (candidates.length) {
    await page.reload();
    await expect(page.locator("h1, h2").first()).toBeVisible();
  }
  return diagnostics;
}

async function validateControlSemantics(page: Page) {
  const diagnostics: string[] = [];
  for (const input of plan.inputs) {
    const control = await plannedControl(page, input.label);
    if (!control) continue;
    const text = await accessibleControlText(control);
    const unit = requiredUnitPattern(input);
    if (unit && !unit.test(text)) {
      diagnostics.push(`${input.label}: accessible label/help text does not identify its unit.`);
    }
    if (input.required && await control.getAttribute("required") === null && await control.getAttribute("aria-required") !== "true") {
      diagnostics.push(`${input.label}: required state is not programmatically exposed.`);
    }
    const actualDefault = await control.inputValue();
    const plannedNumber = Number(input.defaultValue);
    const actualNumber = Number(actualDefault);
    const defaultMatches = input.type === "number" || input.type === "currency" || input.type === "percentage"
      ? Number.isFinite(plannedNumber) && Number.isFinite(actualNumber) && plannedNumber === actualNumber
      : actualDefault === input.defaultValue;
    if (!defaultMatches) {
      diagnostics.push(`${input.label}: must initialize to planned default '${input.defaultValue}', not '${actualDefault}'.`);
    }
    if (["number", "currency", "percentage"].includes(input.type)) {
      const type = await control.getAttribute("type");
      const min = Number(await control.getAttribute("min"));
      const max = Number(await control.getAttribute("max"));
      const step = Number(await control.getAttribute("step"));
      if (!["number", "range"].includes(type ?? "")) diagnostics.push(`${input.label}: numeric plan input is not a numeric control.`);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max || !Number.isFinite(step) || step <= 0) {
        diagnostics.push(`${input.label}: numeric control must expose finite min, max, and positive step constraints.`);
      }
      if (input.type === "percentage" && Number.isFinite(max) && max > 100) {
        diagnostics.push(`${input.label}: percentage maximum must not exceed 100.`);
      }
    }
  }
  return diagnostics;
}

async function validateInvalidPersistence(page: Page) {
  const diagnostics: string[] = [];
  if (!plan.persistence?.enabled) return diagnostics;
  const save = page.getByRole("button", { name: /save/i }).first();
  if (!await save.count() || !await save.isVisible()) return diagnostics;
  const candidate = plan.inputs.find((input) => input.required && ["number", "currency", "percentage"].includes(input.type));
  if (!candidate) return diagnostics;
  const control = await plannedControl(page, candidate.label);
  if (!control) return diagnostics;
  const min = Number(await control.getAttribute("min"));
  const step = Number(await control.getAttribute("step"));
  await control.fill(String(min - (Number.isFinite(step) && step > 0 ? step : 1)));
  await control.blur();
  const current = Number(await control.inputValue());
  if (Number.isFinite(current) && current >= min) {
    await page.reload();
    await expect(page.locator("h1, h2").first()).toBeVisible();
    return diagnostics;
  }
  if (await control.getAttribute("aria-invalid") !== "true") {
    diagnostics.push(`${candidate.label}: invalid state must set aria-invalid to true.`);
  }
  const describedBy = (await control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  const describedText = describedBy.length
    ? await page.locator(describedBy.map(idSelector).join(",")).allTextContents()
    : [];
  if (!describedText.join(" ").trim()) diagnostics.push(`${candidate.label}: invalid state must expose an associated validation message.`);
  const disabled = await save.isDisabled() || await save.getAttribute("aria-disabled") === "true";
  if (!disabled) diagnostics.push("Save must be disabled while assumptions are invalid.");
  await page.reload();
  await expect(page.locator("h1, h2").first()).toBeVisible();
  return diagnostics;
}

async function validateChartAlternatives(page: Page) {
  const diagnostics: string[] = [];
  const charts = page.locator("svg.recharts-surface");
  for (let index = 0; index < await charts.count(); index += 1) {
    const chart = charts.nth(index);
    if (!await chart.isVisible()) continue;
    const imageWrapper = chart.locator("xpath=ancestor::*[@role='img'][1]");
    const labelledElement = await imageWrapper.count() ? imageWrapper : chart;
    const accessibleName = await labelledElement.getAttribute("aria-label")
      ?? await labelledElement.locator("title").first().textContent().catch(() => null);
    if (!accessibleName?.trim()) diagnostics.push("Every chart must have an accessible name.");
    const describedBy = (await labelledElement.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    const description = describedBy.length
      ? await page.locator(describedBy.map(idSelector).join(",")).allTextContents()
      : [];
    // Recharts forwards role/label props but can omit aria-describedby from its
    // rendered wrapper. A visible summary in the same figure/section remains a
    // valid textual alternative, so do not reject an otherwise accessible
    // workspace solely because the chart library dropped that linkage.
    const chartRegion = chart.locator("xpath=ancestor::figure[1] | ancestor::section[1]").first();
    const scope = await chartRegion.count() ? chartRegion : page.locator("body");
    const nearbySummary = await scope
      .locator('figcaption, [data-chart-summary], .chart-summary, [aria-label*="summary" i], p')
      .allTextContents();
    const hasSummary = [...description, ...nearbySummary].some((value) => value.trim().length >= 20);
    const matchingTableCount = await scope.locator("table caption").filter({ hasText: /projection|chart|annual|year/i }).count();
    if (!hasSummary || matchingTableCount === 0) {
      diagnostics.push(
        `Every chart must have a textual summary and data-table alternative `
        + `(linked descriptions: ${describedBy.length}; nearby summaries: ${nearbySummary.filter((value) => value.trim().length >= 20).length}; matching tables: ${matchingTableCount}).`,
      );
    }
  }
  return diagnostics;
}

async function validateConciseLiveStatus(page: Page) {
  const diagnostics: string[] = [];
  if (!plan.inputs.length || !plan.outputs.length) return diagnostics;
  const live = page.locator('[aria-live="polite"], [role="status"]');
  if (!await live.count()) return ["Interactive results must expose a polite status."];
  const messages = (await live.allTextContents()).map((value) => value.trim()).filter(Boolean);
  if (!messages.some((message) => message.length <= 240)) diagnostics.push("Recalculation must expose a concise status.");
  if (!messages.every((message) => message.length <= 240)) diagnostics.push("Live status must not announce a result block longer than 240 characters.");
  for (const message of messages) {
    const topics = [
      /\btarget\b/i,
      /\b(?:gap|surplus)\b/i,
      /\b(?:time|years?)\b/i,
      /\b(?:balance|portfolio)\b/i,
    ].filter((pattern) => pattern.test(message)).length;
    if (topics > 2) diagnostics.push("Live status must announce a generic confirmation or one primary result, not a multi-output summary.");
  }
  return diagnostics;
}

test("renders, exercises controls, and remains responsive", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
  const qualityDiagnostics: string[] = [];
  try {
    await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 10_000 });
  } catch {
    const body = await page.locator("body").innerText().catch(() => "");
    const rootHTML = await page.locator("#root").innerHTML().catch(() => "");
    qualityDiagnostics.push(
      "Missing visible h1/h2 heading after load. "
      + `Console/page errors: ${errors.join("; ") || "none"}. `
      + `Body text preview: ${body.replace(/\s+/g, " ").trim().slice(0, 300) || "(empty)"}. `
      + `Root HTML preview: ${rootHTML.replace(/\s+/g, " ").trim().slice(0, 300) || "(empty)"}.`,
    );
  }
  const missingInputs: string[] = [];
  const missingOutputs: string[] = [];
  if (!qualityDiagnostics.length) {
    for (const input of plan.inputs) {
      if (!await plannedControl(page, input.label)) missingInputs.push(input.label);
    }
    for (const output of plan.outputs) {
      if (!await plannedOutput(page, output.label)) missingOutputs.push(output.label);
    }
  }
  qualityDiagnostics.push(
    ...(missingInputs.length ? [`Missing controls: ${missingInputs.join("; ")}.`] : []),
    ...(missingOutputs.length ? [`Missing outputs: ${missingOutputs.join("; ")}.`] : []),
  );
  if (!qualityDiagnostics.some((item) => item.startsWith("Missing visible h1/h2"))) {
    qualityDiagnostics.push(
      ...await validateControlSemantics(page),
      ...await validateWholeUnitStepHandling(page),
      ...await validateInvalidPersistence(page),
      ...await validateChartAlternatives(page),
    );
  }

  const headingMissing = qualityDiagnostics.some((item) => item.startsWith("Missing visible h1/h2"));
  if (!headingMissing) {
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    qualityDiagnostics.push(...accessibility.violations.map((violation: { id: string; help: string }) => `WCAG ${violation.id}: ${violation.help}`));

    for (const [index, input] of plan.inputs.entries()) {
      // Exercise every control from the workspace's valid initial state. Numeric
      // financial inputs are often interdependent, so accumulating changes can
      // make later controls appear non-reactive simply because an earlier value
      // (for example, current age) invalidated the whole calculator.
      if (index > 0) {
        await page.reload();
        await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
        await expect(page.locator("h1, h2").first()).toBeVisible();
      }
      const control = await plannedControl(page, input.label);
      if (!control) continue;
      const before = await observableOutput(page);
      await changeControl(control);
      try {
        await expect.poll(() => observableOutput(page)).not.toBe(before);
      } catch {
        // Thresholded inputs can legitimately be unchanged by one step. For
        // example, extending a 50-year horizon to 51 years does not affect a
        // projection that already reaches FIRE in year 20. Exercise a bounded
        // alternative before concluding that the control is disconnected.
        await changeControl(control, true);
        try {
          await expect.poll(() => observableOutput(page)).not.toBe(before);
        } catch {
          qualityDiagnostics.push(`${input.label}: changing the control from the valid initial state did not change a rendered financial output.`);
        }
      }
      await control.blur();
      qualityDiagnostics.push(...await validateConciseLiveStatus(page));
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await assertNoOverflow(page);
    await page.screenshot({ path: "test-results/workspace-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow(page);
    await page.screenshot({ path: "test-results/workspace-mobile.png", fullPage: true });
  } else {
    // Still capture evidence for repair diagnostics when the app never mounts.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "test-results/workspace-desktop.png", fullPage: true }).catch(() => undefined);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "test-results/workspace-mobile.png", fullPage: true }).catch(() => undefined);
  }
  if (qualityDiagnostics.length) {
    throw new Error(`Workspace quality contract failed.\n${[...new Set(qualityDiagnostics)].join("\n")}`);
  }
  expect(errors).toEqual([]);
});

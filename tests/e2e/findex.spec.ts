import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { bundleWorkspace } from "@/lib/workspaces/bundle";

async function enterDemo(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Money,/ })).toBeVisible();
  await page.getByRole("button", { name: "Login as Demo User" }).click();
  await expect(page).toHaveURL(/\/demo\/brain$/);
  await expect(page.getByRole("heading", { name: "Ask about your money, or test a decision." })).toBeVisible();
}

async function seedWorkspace(page: import("@playwright/test").Page) {
  const compiled = await bundleWorkspace([
    {
      path: "src/App.tsx",
      content: `import React, { useState } from "react";
import "./styles.css";
export default function App(){const [amount,setAmount]=useState(50000);return <main><h1>Adaptive purchase lab</h1><label>Purchase amount <input aria-label="Purchase amount" type="range" min="10000" max="100000" value={amount} onChange={(event)=>setAmount(Number(event.target.value))}/></label><output aria-label="Selected amount">{new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(amount)}</output><p>Educational, not financial advice.</p></main>}`,
    },
    { path: "src/styles.css", content: "body{font-family:system-ui}main{padding:24px}label{display:grid;gap:8px}output{display:block;font-size:24px;font-weight:700;margin-top:14px}" },
  ]);
  await page.evaluate(async ({ javascript, css, sha256 }) => {
    const projectId = crypto.randomUUID();
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const plan = {
      schemaVersion: 2, intent: "create", title: "Adaptive purchase lab", goal: "Explore purchase amounts", response: "",
      assumptions: ["Hypothetical USD values"], inputs: [{ id: "purchase_amount", label: "Purchase amount", type: "currency", description: "Purchase price", required: true, defaultValue: "50000" }],
      outputs: [{ id: "selected_amount", label: "Selected amount", description: "Current scenario", format: "USD" }], interactions: ["Changing the range updates the output"],
      layout: ["Responsive single view"], dataNeeds: [], persistence: { enabled: false, stateSchemaVersion: 1, description: "" }, capabilities: [],
      disclosures: ["Educational only"], acceptanceCriteria: ["Range updates output"], clarificationQuestions: [],
    };
    function artifact(id: string, version: number, parentVersionId: string | null) {
      const source = "export default function App(){return <main>Adaptive purchase lab</main>}";
      return {
        schemaVersion: 2, id, projectId, version, parentVersionId, restoredFromVersionId: null, title: "Adaptive purchase lab", prompt: "Build a purchase lab", plan,
        files: [{ path: "src/App.tsx", content: source }],
        bundle: { javascript, css, sha256 },
        manifest: { schemaVersion: 2, entry: "src/App.tsx", capabilities: [], stateSchemaVersion: 1, allowedImports: ["react"], sourceBytes: new TextEncoder().encode(source).length, bundleBytes: new TextEncoder().encode(javascript).length + new TextEncoder().encode(css).length },
        validation: { passed: true, checks: [{ name: "Browser", passed: true, detail: "passed" }], issues: [], review: { passed: true, score: 96, issues: [], strengths: [], acceptanceResults: [{ criterion: "Range updates output", passed: true, detail: "passed" }] } },
        model: "gpt-5.6-sol", effort: "medium", complexity: { level: "standard", riskFlags: [], rationale: "Interactive chart" }, effortEscalations: [],
        tokenUsage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, timings: { assessmentMs: 50, planningMs: 100, codingMs: 300, validationMs: 300, reviewMs: 250, totalMs: 1000 }, durationMs: 1000, repairCount: 0, generatedAt: new Date().toISOString(), provenance: "Test verified workspace", capabilityToken: "x".repeat(32), artifactSignature: "x".repeat(43),
      };
    }
    const request = indexedDB.open("findex-generative-workspaces", 2);
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
        if (!db.objectStoreNames.contains("artifacts")) { const store = db.createObjectStore("artifacts", { keyPath: "id" }); store.createIndex("projectId", "projectId"); }
        if (!db.objectStoreNames.contains("state")) { const store = db.createObjectStore("state", { keyPath: "id" }); store.createIndex("projectId", "projectId"); }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(["projects", "artifacts"], "readwrite");
        transaction.objectStore("projects").put({ id: projectId, name: "Adaptive purchase lab", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), activeVersionId: secondId });
        transaction.objectStore("artifacts").put(artifact(firstId, 1, null));
        transaction.objectStore("artifacts").put(artifact(secondId, 2, firstId));
        transaction.oncomplete = () => { db.close(); localStorage.setItem("findex-active-workspace-v2", projectId); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, { javascript: compiled.javascript, css: compiled.css, sha256: compiled.sha256 });
  await page.reload();
}

test("demo login lands on a calm Brain-first home", async ({ page }, testInfo) => {
  await enterDemo(page);
  await expect(page.getByRole("region", { name: "Financial Brain" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Financial glances" }).getByRole("button")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Can I afford a car next month?" })).toBeVisible();
  await expect(page.locator(".recharts-wrapper")).toHaveCount(0);
  if (testInfo.project.name === "mobile-390") {
    await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button")).toHaveCount(4);
  } else {
    await expect(page.getByRole("complementary", { name: "Primary navigation" })).toBeVisible();
  }
});

test("route navigation, refresh, and browser history preserve each money view", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: /^Spending/ }).click();
  await expect(page).toHaveURL(/\/demo\/spending$/);
  await expect(page.getByRole("heading", { name: "See where your money went." })).toBeVisible();
  await page.getByRole("button", { name: /^Portfolio/ }).click();
  await expect(page.getByRole("heading", { name: "Your long-term money, in one picture." })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/demo\/portfolio$/);
  await expect(page.getByText("$145,450", { exact: true }).first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/demo\/spending$/);
  await page.getByRole("button", { name: /^Cash flow/ }).click();
  await expect(page.getByRole("heading", { name: "Know what your money can handle next." })).toBeVisible();
});

test("transaction filters and totals stay reconciled with displayed rows", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/demo/spending");
  await page.getByLabel("Date preset").selectOption("last_month");
  await page.getByLabel("Category").selectOption("dining");
  await page.getByLabel("Type").selectOption("expense");
  const summary = page.getByRole("region", { name: "Filtered transaction summary" });
  await expect(summary.getByText("$366.21", { exact: true })).toBeVisible();
  await expect(summary.getByText("8", { exact: true })).toBeVisible();
  const table = page.getByRole("table", { name: "Transactions matching the selected filters" });
  await expect(table.locator("tbody tr")).toHaveCount(8);
  await expect(table.locator("tbody tr")).toContainText(["Dining", "Dining", "Dining", "Dining", "Dining", "Dining", "Dining", "Dining"]);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByLabel("Search transactions").fill("Sweetgreen");
  await expect(table.locator("tbody tr").first()).toContainText("Sweetgreen");
  await page.getByLabel("Account").selectOption("checking");
  await page.getByLabel("Sort").selectOption("amount_high");
  await page.getByRole("button", { name: "Recurring only" }).click();
  await expect(page.getByRole("button", { name: "Recurring only" })).toHaveAttribute("aria-pressed", "true");
});

test("recurring activity provides distinct list and calendar alternatives", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/demo/spending");
  await page.getByRole("tab", { name: "Recurring" }).click();
  await expect(page.getByText("Bills, subscriptions, and investing")).toBeVisible();
  await expect(page.getByText("$79.97", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Calendar" }).click();
  await expect(page.getByLabel("Next 30 days recurring calendar")).toBeVisible();
  await expect(page.getByText("Roth IRA auto-invest")).toBeVisible();
});

test("portfolio totals, allocation, account cards, and holdings reconcile", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/demo/portfolio");
  await expect(page.getByText("$145,450", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$180,557.72", { exact: true })).toBeVisible();
  for (const amount of ["$86,420", "$28,360", "$21,740", "$8,930"]) await expect(page.getByText(amount, { exact: true })).toBeVisible();
  for (const allocation of ["61.1% · target 60%", "20.0% · target 20%", "12.4% · target 15%", "6.6% · target 5%"]) await expect(page.getByText(allocation, { exact: true })).toBeVisible();
  const table = page.getByRole("table", { name: "Synthetic investment holdings as of July 19, 2026" });
  const total = await table.locator("tbody tr td:last-child").allTextContents().then((values) => values.reduce((sum, value) => sum + Number(value.replace(/[$,]/g, "")), 0));
  expect(total).toBe(145_450);
  await page.getByLabel("Sort").selectOption("asset");
  await expect(table.locator("tbody tr").first()).toContainText("FXNAX");
});

test("cash-flow horizons update details without double-counting payroll", async ({ page }) => {
  await enterDemo(page);
  await page.goto("/demo/cash-flow");
  const summary = page.getByRole("region", { name: "Cash flow summary" });
  await expect(summary.getByText("$6,560", { exact: true })).toBeVisible();
  await expect(summary.getByText("$858", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "90 day monthly income, outflow, and investing projection" })).toBeVisible();
  await page.getByRole("button", { name: "30 days" }).click();
  await expect(page.getByRole("img", { name: "30 day monthly income, outflow, and investing projection" })).toBeVisible();
  await expect(page.getByText("401(k) and HSA payroll contributions are not deducted from take-home again.")).toBeVisible();
  await page.getByRole("button", { name: "Aug 2026" }).click();
  await expect(page.locator(".fd-month-detail").getByRole("heading", { name: "Aug 2026" })).toBeVisible();
  await page.getByText("View forecast as a table").click();
  await expect(page.locator(".fd-chart-data table")).toBeVisible();
});

test("Financial Brain streams the exact grounded dining answer", async ({ page }) => {
  await enterDemo(page);
  const input = page.getByLabel("Message the Financial Brain");
  await input.fill("How much did I spend on dining out last month?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText("$366.21");
  await expect(page.locator(".provenance-chip").last()).toContainText("8 Dining transactions · Jun 1–30");
});

test("a car scenario compares the base forecast with a not-covered result", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "Can I afford a car next month?" }).click();
  await page.getByLabel("Purchase date").fill("2026-08-15");
  await page.getByLabel("Upfront cost").fill("15000");
  await page.getByLabel("Monthly payment").fill("650");
  await page.getByRole("button", { name: "Run decision check" }).click();
  const card = page.getByRole("article", { name: "This purchase is not covered" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Base lowest checking");
  await expect(card).toContainText("Scenario lowest checking");
  await expect(card.getByRole("link", { name: "Inspect the forecast" })).toHaveAttribute("href", "/demo/cash-flow");
});

test("unconfigured generation fails explicitly without publishing an unrelated fallback", async ({ page }) => {
  await enterDemo(page);
  await page.getByLabel("Message the Financial Brain").fill("Build a cash versus EMI planner for a major purchase");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText("OPENAI_API_KEY");
  await expect(page.locator(".generated-card")).toHaveCount(0);
  await expect(page.getByText("FIRE runway")).toHaveCount(0);
});

test("saved workspace versions render in a locked interactive iframe and survive reload", async ({ page }) => {
  await enterDemo(page);
  await seedWorkspace(page);
  await expect(page.getByRole("heading", { name: "Adaptive purchase lab" }).first()).toBeVisible();
  const frameElement = page.locator(".workspace-frame");
  await expect(frameElement).toHaveAttribute("sandbox", "allow-scripts");
  const preview = page.frameLocator(".workspace-frame");
  await expect(preview.getByRole("heading", { name: "Adaptive purchase lab" })).toBeVisible();
  const amount = preview.getByLabel("Purchase amount");
  await amount.fill("90000");
  await expect(preview.getByLabel("Selected amount")).toHaveText("$90,000");
  await frameElement.evaluate((iframe) => (iframe as HTMLIFrameElement).contentWindow?.postMessage({
    type: "findex:rpc", nonce: "malformed-global-message", id: "1", capability: "ledger.snapshot", input: {},
  }, "*"));
  await expect(preview.getByLabel("Selected amount")).toHaveText("$90,000");
  await page.getByText("Version history · 2").click();
  await expect(page.getByText(/v1 ·/)).toBeVisible();
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Workspace name").fill("Major purchase planner");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Major purchase planner" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Major purchase planner" })).toBeVisible();
});

test("layout has no horizontal document overflow at 390px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "Mobile-only assertion");
  await enterDemo(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
});

test("critical views pass automated accessibility and reflow checks", async ({ page }, testInfo) => {
  await enterDemo(page);
  const axe = await new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
  expect(axe.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("region", { name: "Financial Brain" })).toBeVisible();
  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 640, height: 720 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { bundleWorkspace } from "@/lib/workspaces/bundle";
import type { WorkspaceArtifactV2 } from "@/lib/workspaces/contracts";

async function mockBrain(page: import("@playwright/test").Page) {
  await page.route("**/api/brain", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { message?: string };
    const message = body.message?.toLowerCase() ?? "";
    const events = message.includes("dining") || message.includes("where did my money go")
      ? [
          { type: "tool_result", tool: "get_spending_summary", summary: "$366.21", provenance: "8 Dining transactions · Jun 1–30" },
          {
            type: "insight_card",
            card: {
              kind: "spending", title: "Dining spending, explained", conclusion: "You spent $366.21 across 8 transactions in the selected period.",
              metrics: [{ label: "Total", value: "$366.21" }, { label: "Transactions", value: "8" }, { label: "Top merchant", value: "Sweetgreen" }],
              provenance: "8 Dining transactions · Jun 1–30", assumptions: ["Period: Jun 1–30", "Transfers and income are excluded"],
              relatedHref: "/demo/spending", relatedLabel: "Review transactions",
            },
          },
          { type: "assistant_delta", delta: "You spent $366.21 dining out last month across 8 transactions." },
        ]
      : message.includes("afford a car")
        ? [
            { type: "tool_result", tool: "evaluate_purchase_scenario", summary: "not_covered", provenance: "90-day purchase scenario · demo ledger" },
            {
              type: "insight_card",
              card: {
                kind: "decision", status: "not_covered", title: "This purchase is not covered", conclusion: "The modeled purchase would breach the protected checking buffer.",
                metrics: [{ label: "Base lowest checking", value: "$8,809" }, { label: "Scenario lowest checking", value: "-$6,191", tone: "warning" }, { label: "Safe to spend after", value: "$0" }],
                provenance: "90-day purchase scenario · demo ledger", assumptions: ["$15,000 upfront", "$650 recurring monthly cost"],
                relatedHref: "/demo/cash-flow", relatedLabel: "Inspect the forecast",
              },
            },
            { type: "assistant_delta", delta: "This purchase is not covered by the modeled cash-flow buffer." },
          ]
        : message.includes("portfolio allocation")
          ? [
              {
                type: "assistant_delta",
                delta: [
                  "Your **$145,450 portfolio** is close to Jordan’s saved target.",
                  "",
                  "### Takeaway",
                  "",
                  "| Asset class | Current | Target | Difference |",
                  "|---|---|---|---|",
                  "| U.S. equity | **61.1%** | 60.0% | **+1.1 pts** |",
                  "| Bonds | **12.4%** | 15.0% | **-2.6 pts** |",
                  "",
                  "- Keep contributions on autopilot",
                  "- Recheck after the next paycheck",
                ].join("\n"),
              },
            ]
        : [
            { type: "workspace_failed", code: "BUILD_UNAVAILABLE", message: "Findex couldn't start a workspace build because secure generation is unavailable. Nothing was published.", recoverable: true },
          ];
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    });
  });
}

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
  const seeded = await page.evaluate(async ({ javascript, css, sha256 }) => {
    const projectId = crypto.randomUUID();
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const plan = {
      schemaVersion: 2, intent: "create", title: "Adaptive purchase lab", goal: "Explore purchase amounts", response: "",
      assumptions: ["Hypothetical USD values"], inputs: [{ id: "purchase_amount", label: "Purchase amount", type: "currency", description: "Purchase price", required: true, defaultValue: "50000", min: "0", max: "1000000", step: "100" }],
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
        qualityTier: "verified",
        model: "gpt-5.6-sol", effort: "medium", complexity: { level: "standard", riskFlags: [], rationale: "Interactive chart" }, effortEscalations: [],
        tokenUsage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 }, timings: { assessmentMs: 50, planningMs: 100, codingMs: 300, validationMs: 300, reviewMs: 250, totalMs: 1000 }, durationMs: 1000, repairCount: 0, generatedAt: new Date().toISOString(), provenance: "Test verified workspace", capabilityToken: "x".repeat(32), artifactSignature: "x".repeat(43),
      };
    }
    const request = indexedDB.open("findex-generative-workspaces", 3);
    return new Promise<Record<string, unknown>>((resolve, reject) => {
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
        transaction.oncomplete = () => {
          const active = artifact(secondId, 2, firstId);
          db.close();
          localStorage.setItem("findex-active-workspace-v2", projectId);
          resolve(active);
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, { javascript: compiled.javascript, css: compiled.css, sha256: compiled.sha256 });
  await page.reload();
  return seeded as WorkspaceArtifactV2;
}

test("demo login lands on a calm Brain-first home", async ({ page }, testInfo) => {
  await enterDemo(page);
  await expect(page.getByRole("region", { name: "Financial Brain" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Financial glances" }).getByRole("button")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Can I afford a car next month?" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "What can the Financial Brain do?" })).toBeVisible();
  await expect(page.locator(".fd-guidance-tip")).toContainText("Try a prompt below, or open help for what the Brain can do.");
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
  await expect(page.getByRole("button", { name: "Where did my money go last month?" })).toBeVisible();
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
  await mockBrain(page);
  await enterDemo(page);
  const input = page.getByLabel("Message the Financial Brain");
  await input.fill("How much did I spend on dining out last month?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText("$366.21");
  await expect(page.locator(".provenance-chip").last()).toContainText("8 Dining transactions · Jun 1–30");
});

test("Financial Brain sends with Enter while preserving Shift+Enter and IME composition", async ({ page }) => {
  await mockBrain(page);
  await enterDemo(page);
  const input = page.getByLabel("Message the Financial Brain");
  const userMessages = page.locator(".message.user");
  await input.fill("line one");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("line one\n");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(userMessages).toHaveCount(0);
  await input.fill("How much did I spend on dining out last month?");
  await input.press("Enter");
  await expect(userMessages).toHaveCount(1);
  await expect(page.locator(".message.assistant").last()).toContainText("$366.21");
  await expect(page.locator("body")).not.toContainText(/\bSol\b/);
});

test("a car scenario compares the base forecast with a not-covered result", async ({ page }) => {
  await mockBrain(page);
  await enterDemo(page);
  await page.getByRole("region", { name: "Financial Brain" }).getByRole("button", { name: "Can I afford a car next month?" }).click();
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

test("unavailable generation fails explicitly without publishing an unrelated fallback", async ({ page }) => {
  await mockBrain(page);
  await enterDemo(page);
  await page.getByLabel("Message the Financial Brain").fill("Build a cash versus EMI planner for a major purchase");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText("Findex couldn't start a workspace build");
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

test("an active workspace run reconnects after reload and recovers a missed publication", async ({ page }) => {
  await enterDemo(page);
  const prior = await seedWorkspace(page);
  const published: WorkspaceArtifactV2 = {
    ...prior,
    id: crypto.randomUUID(),
    version: 3,
    parentVersionId: prior.id,
    title: "Recovered purchase lab",
    prompt: "Build a recovered purchase lab",
    plan: { ...prior.plan, title: "Recovered purchase lab" },
    model: "gpt-5.6-terra",
    generatedAt: new Date().toISOString(),
  };
  let eventCalls = 0;
  let terminal = false;
  const eventUrls: string[] = [];

  await page.route(/\/api\/brain$/, async (route) => route.fulfill({
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
    body: `data: ${JSON.stringify({ type: "workspace_started", runId: "run-reload", accessToken: "signed-run-token" })}\n\n`,
  }));
  await page.route(/\/api\/brain\/runs\/run-reload\/events/, async (route) => {
    eventCalls += 1;
    eventUrls.push(route.request().url());
    const event = { type: "build_progress", phase: "coding", detail: "Findex is building the application" };
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
      body: `id: 0\ndata: ${JSON.stringify(event)}\n\n`,
    });
  });
  await page.route(/\/api\/brain\/runs\/run-reload$/, async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(terminal
      ? { status: "completed", returnValue: { status: "completed", artifact: published } }
      : { status: "running", returnValue: null }),
  }));

  const input = page.getByLabel("Message the Financial Brain");
  await input.fill("Build a recovered purchase lab");
  await input.press("Enter");
  await expect(page.getByRole("status")).toContainText("Findex is building the application");
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open("findex-generative-workspaces", 3);
    return new Promise<number | null>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction("brainRuns").objectStore("brainRuns").get("active");
        get.onerror = () => reject(get.error);
        get.onsuccess = () => { const value = get.result as { lastEventIndex?: number } | undefined; db.close(); resolve(value?.lastEventIndex ?? null); };
      };
    });
  })).toBe(0);

  terminal = true;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Recovered purchase lab" }).first()).toBeVisible();
  await expect(page.locator(".message.assistant").last()).toContainText("saved as version 3");
  expect(eventCalls).toBeGreaterThanOrEqual(2);
  expect(eventUrls.at(-1)).toContain("startIndex=1");
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open("findex-generative-workspaces", 3);
    return new Promise<boolean>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction("brainRuns").objectStore("brainRuns").get("active");
        get.onerror = () => reject(get.error);
        get.onsuccess = () => { const missing = get.result === undefined; db.close(); resolve(missing); };
      };
    });
  })).toBe(true);
});

test("stopping a durable build cancels the run and preserves the published workspace", async ({ page }) => {
  await enterDemo(page);
  await seedWorkspace(page);
  let cancellations = 0;
  await page.route(/\/api\/brain$/, async (route) => route.fulfill({
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
    body: `data: ${JSON.stringify({ type: "workspace_started", runId: "run-cancel", accessToken: "signed-run-token" })}\n\n`,
  }));
  await page.route(/\/api\/brain\/runs\/run-cancel\/events/, async (route) => route.fulfill({
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
    body: `id: 0\ndata: ${JSON.stringify({ type: "build_progress", phase: "checking", detail: "Findex is checking the build" })}\n\n`,
  }));
  await page.route(/\/api\/brain\/runs\/run-cancel$/, async (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ status: "running", returnValue: null }),
  }));
  await page.route(/\/api\/brain\/runs\/run-cancel\/cancel$/, async (route) => {
    cancellations += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "cancelled" }) });
  });

  const input = page.getByLabel("Message the Financial Brain");
  await input.fill("Build another purchase lab");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText("previously published workspace is unchanged");
  await expect(page.getByRole("heading", { name: "Adaptive purchase lab" }).first()).toBeVisible();
  expect(cancellations).toBe(1);
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

test("ask the brain from spending shows handoff and runs the prompt", async ({ page }) => {
  await mockBrain(page);
  await enterDemo(page);
  await page.getByRole("button", { name: /^Spending/ }).click();
  await page.getByRole("button", { name: /Ask the Brain/ }).click();
  await expect(page).toHaveURL(/\/demo\/brain$/);
  await expect(page.getByRole("status", { name: "Brain handoff context" })).toContainText("From Spending");
  await expect(page.getByText(/\$366\.21|dining out last month/i).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Dismiss handoff" }).click();
  await expect(page.getByRole("status", { name: "Brain handoff context" })).toHaveCount(0);
});

test("page guidance help explains ask decide build", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "What can the Financial Brain do?" }).click();
  await expect(page.getByText("Ask", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Decide", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Build a tool", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");
});

test("reduced motion still navigates between views", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterDemo(page);
  await page.getByRole("button", { name: /^Portfolio/ }).click();
  await expect(page).toHaveURL(/\/demo\/portfolio$/);
  await expect(page.getByRole("heading", { name: "Your long-term money, in one picture." })).toBeVisible();
});

test("spending table and brain composer meet comfortable font sizes", async ({ page }) => {
  await enterDemo(page);
  const brainInput = page.getByLabel("Message the Financial Brain");
  const brainSize = await brainInput.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(brainSize).toBeGreaterThanOrEqual(14);
  await page.goto("/demo/spending");
  const cell = page.locator(".fd-data-table td, table td").first();
  await expect(cell).toBeVisible();
  const tableSize = await cell.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(tableSize).toBeGreaterThanOrEqual(13);
});

test("brain assistant replies render markdown structure", async ({ page }) => {
  await mockBrain(page);
  await enterDemo(page);
  await page.getByRole("region", { name: "Financial Brain" }).getByRole("button", { name: "How is my portfolio allocation balanced?" }).click();
  const reply = page.locator(".message.assistant .brain-markdown").filter({ hasText: "$145,450 portfolio" });
  await expect(reply.getByRole("heading", { name: "Takeaway" })).toBeVisible({ timeout: 15_000 });
  await expect(reply.locator("table")).toBeVisible();
  await expect(reply.getByRole("columnheader", { name: "Asset class" })).toBeVisible();
  await expect(reply.locator("strong").filter({ hasText: "$145,450 portfolio" })).toBeVisible();
  await expect(reply).not.toContainText("|---|");
  await expect(reply).not.toContainText("### Takeaway");
});

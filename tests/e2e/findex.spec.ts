import { expect, test } from "@playwright/test";
import { bundleWorkspace } from "@/lib/workspaces/bundle";

async function enterDemo(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Money,/ })).toBeVisible();
  await page.getByRole("button", { name: "Login as Demo User" }).click();
  await expect(page.getByRole("heading", { name: /Morning, Jordan/ })).toBeVisible();
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

test("demo login reaches the populated predictive dashboard", async ({ page }) => {
  await enterDemo(page);
  await expect(page.getByText("Safe to spend", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$7,309")).toBeVisible();
  await expect(page.getByLabel("Thirty day projected balance and safe-to-spend chart")).toBeVisible();
  await expect(page.getByText("Latest transactions")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Financial Brain" })).toBeVisible();
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

test("unconfigured generation fails explicitly without publishing an unrelated fallback", async ({ page }, testInfo) => {
  await enterDemo(page);
  if (testInfo.project.name === "mobile-390") await page.getByRole("button", { name: "Ask FinDex" }).click();
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

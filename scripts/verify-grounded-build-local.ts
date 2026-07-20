/**
 * Paid smoke: my-money build should publish an interactive draft with ledger capabilities.
 * Requires a running local app with WORKSPACE_EXECUTION_MODE=local and OPENAI_API_KEY.
 */
import { chromium } from "@playwright/test";

const baseUrl = process.env.FINDEX_LOCAL_URL ?? "http://localhost:3000";
const prompt = "Build a wealth projection tool grounded in my cash flow and portfolio.";
const terminalTimeoutMs = 20 * 60_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.evaluate(() => window.sessionStorage.setItem("findex-demo-entered-v1", "true"));
    await page.goto(`${baseUrl.replace(/\/$/, "")}/demo/brain`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const composer = page.getByLabel("Message the Financial Brain");
    await composer.waitFor({ state: "visible", timeout: 30_000 });
    await composer.fill(prompt);
    await composer.press("Enter");

    const deadline = Date.now() + terminalTimeoutMs;
    while (Date.now() < deadline) {
      if (await page.locator(".generated-card").count()) break;
      const body = await page.locator("body").innerText();
      if (/couldn['’]t|nothing was published/i.test(body) && !/working draft/i.test(body)) {
        throw new Error(body.slice(0, 400));
      }
      await page.waitForTimeout(2_000);
    }
    await page.locator(".generated-card").first().waitFor({ state: "visible", timeout: 10_000 });

    const telemetry = await page.evaluate(async () => {
      const projectId = localStorage.getItem("findex-active-workspace-v2");
      if (!projectId) return null;
      const request = indexedDB.open("findex-generative-workspaces", 3);
      return new Promise<Record<string, unknown> | null>((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const projectRequest = db.transaction("projects").objectStore("projects").get(projectId);
          projectRequest.onerror = () => reject(projectRequest.error);
          projectRequest.onsuccess = () => {
            const project = projectRequest.result as { activeVersionId?: string } | undefined;
            if (!project?.activeVersionId) {
              db.close();
              resolve(null);
              return;
            }
            const artifactRequest = db.transaction("artifacts").objectStore("artifacts").get(project.activeVersionId);
            artifactRequest.onerror = () => reject(artifactRequest.error);
            artifactRequest.onsuccess = () => {
              const artifact = artifactRequest.result as {
                qualityTier?: string;
                plan?: { capabilities?: string[] };
              } | undefined;
              db.close();
              resolve(artifact ? { qualityTier: artifact.qualityTier, capabilities: artifact.plan?.capabilities ?? [] } : null);
            };
          };
        };
      });
    });
    assert(telemetry, "No persisted grounded workspace artifact.");
    const caps = (telemetry.capabilities as string[]) ?? [];
    assert(caps.some((item) => item.startsWith("ledger.")), `Expected ledger capabilities, got ${caps.join(",") || "(none)"}`);
    assert(telemetry.qualityTier === "draft" || telemetry.qualityTier === "verified", "Missing qualityTier.");
    const frame = page.frameLocator(".workspace-frame");
    await frame.locator("body").waitFor({ state: "visible", timeout: 30_000 });
    console.log(JSON.stringify({ event: "grounded_build_gate", state: "passed", telemetry }));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ event: "grounded_build_gate", state: "failed", message: error instanceof Error ? error.message : "Unknown failure" }));
  process.exitCode = 1;
});

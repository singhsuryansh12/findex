import { chromium, type Page } from "@playwright/test";

const baseUrl = process.env.FINDEX_LOCAL_URL ?? "http://localhost:3000";
const prompt = "Build a FIRE calculator for me to plan my retirement.";
const terminalTimeoutMs = 20 * 60_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function visibleFindexFailure(page: Page) {
  // A mounted draft/verified card means the product succeeded; background polish notes may still say "couldn't".
  if (await page.locator(".generated-card").count()) return null;
  const messages = await page.locator(".message.assistant").allTextContents().catch(() => []);
  return [...messages].reverse().find((message) => /couldn['’]t|failed|nothing was published/i.test(message) && !/working draft|still available/i.test(message))?.trim() ?? null;
}

async function activeArtifactTelemetry(page: Page) {
  return page.evaluate(async () => {
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
              title?: string;
              version?: number;
              qualityTier?: string;
              complexity?: { level?: string };
              repairCount?: number;
              tokenUsage?: unknown;
              timings?: unknown;
              stageTraces?: unknown;
              plan?: { assumptions?: string[]; disclosures?: string[] };
              validation?: { passed?: boolean; review?: { score?: number } };
            } | undefined;
            db.close();
            resolve(artifact ? {
              title: artifact.title,
              version: artifact.version,
              qualityTier: artifact.qualityTier,
              complexity: artifact.complexity,
              repairCount: artifact.repairCount,
              tokenUsage: artifact.tokenUsage,
              timings: artifact.timings,
              stageTraces: artifact.stageTraces,
              assumptions: artifact.plan?.assumptions,
              disclosures: artifact.plan?.disclosures,
              validation: artifact.validation,
            } : null);
          };
        };
      };
    });
  });
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  let brainPosts = 0;
  const consoleErrors: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/brain") brainPosts += 1;
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    console.log(JSON.stringify({ event: "live_fire_gate", state: "opening", baseUrl }));
    const brainUrl = `${baseUrl.replace(/\/$/, "")}/demo/brain`;
    // Seed the demo session directly — client router navigation after the login
    // button is flaky against the hosted Next.js build under Playwright.
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.evaluate(() => window.sessionStorage.setItem("findex-demo-entered-v1", "true"));
    await page.goto(brainUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByLabel("Message the Financial Brain").waitFor({ state: "visible", timeout: 30_000 });

    const composer = page.getByLabel("Message the Financial Brain");
    await composer.fill(prompt);
    await composer.press("Enter");
    assert(brainPosts === 1, `Expected exactly one Brain request after Enter, observed ${brainPosts}.`);
    console.log(JSON.stringify({ event: "live_fire_gate", state: "submitted", brainPosts }));

    const workflowStartedDeadline = Date.now() + 240_000;
    let lastPhase = "";
    while (Date.now() < workflowStartedDeadline) {
      const phase = (await page.getByRole("status").textContent().catch(() => ""))?.replace(/\s+/g, " ").trim() ?? "";
      if (phase && phase !== lastPhase) {
        lastPhase = phase;
        console.log(JSON.stringify({ event: "live_fire_gate", state: "progress", phase }));
      }
      const failure = await visibleFindexFailure(page);
      if (failure) throw new Error(failure);
      if (/building your workspace|working draft|refining the draft|checking the build|verifying interactions|reviewing/i.test(phase)) break;
      if (await page.locator(".generated-card").count()) break;
      await page.waitForTimeout(1_000);
    }
    assert(
      /building your workspace|working draft|refining the draft|checking the build|verifying interactions|reviewing/i.test(lastPhase)
        || Boolean(await page.locator(".generated-card").count()),
      "The durable workflow did not start within four minutes.",
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    assert(brainPosts === 1, `Reload started another paid Brain request; observed ${brainPosts}.`);
    console.log(JSON.stringify({ event: "live_fire_gate", state: "reloaded_same_run", brainPosts }));

    const terminalDeadline = Date.now() + terminalTimeoutMs;
    lastPhase = "";
    let stuckReconnectSince: number | null = null;
    while (Date.now() < terminalDeadline) {
      const phase = (await page.getByRole("status").textContent().catch(() => ""))?.replace(/\s+/g, " ").trim() ?? "";
      if (phase && phase !== lastPhase) {
        lastPhase = phase;
        console.log(JSON.stringify({ event: "live_fire_gate", state: "progress", phase }));
      }
      if (/reconnecting to the same build/i.test(phase)) {
        stuckReconnectSince ??= Date.now();
        if (Date.now() - stuckReconnectSince > 90_000) {
          await page.reload({ waitUntil: "domcontentloaded" });
          stuckReconnectSince = null;
        }
      } else {
        stuckReconnectSince = null;
      }
      if (await page.locator(".generated-card").count()) break;
      const failure = await visibleFindexFailure(page);
      if (failure) throw new Error(failure);
      await page.waitForTimeout(2_000);
    }

    const card = page.locator(".generated-card").first();
    await card.waitFor({ state: "visible", timeout: 10_000 });
    assert(brainPosts === 1, `Expected one paid Brain request for the entire run, observed ${brainPosts}.`);
    const cardTitle = (await card.getByRole("heading", { level: 2 }).textContent())?.trim() ?? "";
    assert(/fire|retire|financial independence/i.test(cardTitle), `Published workspace title is not FIRE-specific: ${cardTitle}`);
    assert(!/\bSol\b/.test(await page.locator("body").innerText()), "Provider/model copy is visible outside collapsed technical provenance.");

    const frame = page.frameLocator(".workspace-frame");
    const frameBody = frame.locator("body");
    await frameBody.waitFor({ state: "visible", timeout: 30_000 });
    // Wait for hydration — the shell can be visible before React paints methodology/disclosure.
    await frame.getByText(/not financial advice/i).first().waitFor({ state: "visible", timeout: 30_000 });
    const originalText = await frameBody.innerText();
    assert(/withdrawal|safe withdrawal/i.test(originalText), "The calculator does not visibly explain its withdrawal-rate assumption.");
    assert(/inflation|return|contribution/i.test(originalText), "The calculator does not visibly explain growth, inflation, or contribution assumptions.");
    assert(/not financial advice/i.test(originalText), "The educational disclosure is missing from the generated workspace.");

    const numericInputs = frame.locator('input[type="number"], input[type="range"]');
    const inputCount = await numericInputs.count();
    assert(inputCount > 0, "The published FIRE calculator has no numeric interactive input.");
    let changedOutput = false;
    for (let index = 0; index < inputCount && !changedOutput; index += 1) {
      const input = numericInputs.nth(index);
      const values = await input.evaluate((element) => {
        const control = element as HTMLInputElement;
        return { value: Number(control.value), min: Number(control.min), max: Number(control.max), step: Number(control.step) };
      });
      const step = Number.isFinite(values.step) && values.step > 0 ? values.step : Math.max(1, Math.abs(values.value) * 0.1);
      const candidate = Number.isFinite(values.max) && values.max > values.value
        ? Math.min(values.max, values.value + step)
        : Number.isFinite(values.min) && values.min < values.value
          ? Math.max(values.min, values.value - step)
          : values.value + step;
      if (!Number.isFinite(candidate) || candidate === values.value) continue;
      await input.fill(String(candidate));
      await page.waitForTimeout(500);
      changedOutput = (await frameBody.innerText()) !== originalText;
    }
    assert(changedOutput, "Changing the calculator inputs did not change any rendered retirement output.");

    const telemetry = await activeArtifactTelemetry(page);
    assert(telemetry, "The published artifact was not persisted in IndexedDB.");
    const typedTelemetry = telemetry as {
      qualityTier?: string;
      complexity?: { level?: string };
      repairCount?: number;
      stageTraces?: Array<{ stage?: string; model?: string; effort?: string; outcome?: string }>;
      validation?: { passed?: boolean; review?: { score?: number } };
    };
    assert(
      typedTelemetry.complexity?.level === "simple" || typedTelemetry.complexity?.level === "standard",
      `FIRE routed as ${typedTelemetry.complexity?.level ?? "unknown"} instead of simple/standard.`,
    );
    assert((typedTelemetry.repairCount ?? 0) <= 1, "The workflow exceeded the single-repair limit.");
    assert(typedTelemetry.validation?.passed === true, "The persisted artifact is not marked as validated.");
    assert(typedTelemetry.qualityTier === "draft" || typedTelemetry.qualityTier === "verified", "Artifact qualityTier missing.");
    if (typedTelemetry.qualityTier === "verified") {
      assert((typedTelemetry.validation.review?.score ?? 0) >= 90, "The independent review score is below the verified publication threshold.");
    }
    const buildTrace = typedTelemetry.stageTraces?.find((trace) => trace.stage === "building");
    assert(buildTrace?.model === "gpt-5.6-terra" && buildTrace.effort === "medium", "The FIRE build did not use Terra with medium reasoning.");
    assert(typedTelemetry.stageTraces?.every((trace) => trace.outcome === "completed"), "At least one paid model stage did not complete successfully.");
    assert(consoleErrors.length === 0, `Browser console errors: ${consoleErrors.join(" | ")}`);

    console.log(JSON.stringify({ event: "live_fire_gate", state: "passed", brainPosts, telemetry }));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ event: "live_fire_gate", state: "failed", message: error instanceof Error ? error.message : "Unknown failure" }));
  process.exitCode = 1;
});

import { beforeAll, describe, expect, it, vi } from "vitest";
import { POST as capabilityPost } from "@/app/api/workspace/capability/route";
import type { CapabilityName, WorkspaceBuildPlan, WorkspaceFile } from "@/lib/workspaces/contracts";
import { validateAndBundleWorkspace } from "@/lib/workspaces/sandbox";
import { sessionFor } from "@/lib/workspaces/session";
import { signArtifactSignature, signCapabilityToken } from "@/lib/workspaces/signing";

const enabled = process.env.RUN_LIVE_PROVIDER_EVALS === "1";
const artifactHash = "c".repeat(64);

function liveSession() {
  const session = sessionFor(new Request("http://localhost"));
  const cookie = session.cookie?.split(";")[0];
  if (!cookie) throw new Error("Could not create a live-evaluation demo session.");
  return { id: session.id, cookie };
}

async function capability(capabilityName: CapabilityName, input: unknown) {
  const session = liveSession();
  const artifactId = crypto.randomUUID();
  const grants = [capabilityName];
  return capabilityPost(new Request("http://localhost/api/workspace/capability", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: session.cookie },
    body: JSON.stringify({
      artifactId,
      artifactToken: signCapabilityToken(session.id, artifactId, grants),
      artifactHash,
      artifactSignature: signArtifactSignature(session.id, artifactId, artifactHash, grants),
      capability: capabilityName,
      input,
    }),
  }));
}

describe.skipIf(!enabled)("environment-gated live provider release checks", () => {
  beforeAll(() => {
    for (const key of ["OPENAI_API_KEY", "TWELVE_DATA_API_KEY", "VERCEL_SANDBOX_SNAPSHOT_ID"]) {
      if (!process.env[key]) throw new Error(`${key} is required when RUN_LIVE_PROVIDER_EVALS=1.`);
    }
  });

  it("returns a normalized, timestamped Twelve Data quote", async () => {
    const response = await capability("market.quote", { symbol: "AAPL" });
    expect(response.status).toBe(200);
    const payload = await response.json() as { source: string; freshAt: string; result: { symbol: string; price: number } };
    expect(payload.source).toContain("Twelve Data");
    expect(payload.freshAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.result).toMatchObject({ symbol: "AAPL", price: expect.any(Number) });
  }, 30_000);

  it("runs bounded GPT-5.6 Sol analysis through the broker", async () => {
    const response = await capability("ai.analyze", { task: "Explain the tradeoff", context: { cash: 10_000, debt: 2_000 }, depth: "quick" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, source: expect.stringContaining("gpt-5.6-sol") });
  }, 90_000);

  it("executes the complete network-denied Vercel Sandbox validation path", async () => {
    vi.stubEnv("WORKSPACE_EXECUTION_MODE", "vercel");
    const files: WorkspaceFile[] = [{
      path: "src/App.tsx",
      content: `import React,{useState} from "react";export default function App(){const [value,setValue]=useState(5);return <main><h1>Vercel verification lab</h1><label>Value<input type="number" value={value} onChange={(event)=>setValue(Number(event.target.value))}/></label><span>Result</span><output>{value*3}</output></main>}`,
    }];
    const plan: WorkspaceBuildPlan = {
      schemaVersion: 2, intent: "create", title: "Vercel verification lab", goal: "Verify hosted isolation", response: "", assumptions: [],
      inputs: [{ id: "value", label: "Value", type: "number", description: "Test input", required: true, defaultValue: "5" }],
      outputs: [{ id: "result", label: "Result", description: "Triple the value", format: "number" }],
      interactions: ["Value updates Result"], layout: ["Responsive single view"], dataNeeds: [],
      persistence: { enabled: false, stateSchemaVersion: 1, description: "" }, capabilities: [], disclosures: ["Educational only"],
      acceptanceCriteria: ["Value changes Result"], clarificationQuestions: [],
    };
    const result = await validateAndBundleWorkspace(files, "simple", plan);
    expect(result.executor).toBe("vercel");
    expect(result.checks.find((check) => check.name === "Chromium interaction")?.passed).toBe(true);
  }, 120_000);
});

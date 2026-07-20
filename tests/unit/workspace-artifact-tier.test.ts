import { describe, expect, it } from "vitest";
import { workspaceArtifactSchema, type WorkspaceArtifactV2 } from "@/lib/workspaces/contracts";

function baseArtifact(overrides?: Partial<WorkspaceArtifactV2>): WorkspaceArtifactV2 {
  const source = "export default function App(){return <main><h1>Tool</h1></main>}";
  const javascript = "(()=>{})()";
  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    version: 1,
    parentVersionId: null,
    restoredFromVersionId: null,
    title: "Draft wealth tool",
    prompt: "Build a wealth tool",
    plan: {
      schemaVersion: 2, intent: "create", title: "Draft wealth tool", goal: "Project wealth", response: "",
      assumptions: [], inputs: [], outputs: [], interactions: [], layout: ["responsive"], dataNeeds: [],
      persistence: { enabled: false, stateSchemaVersion: 1, description: "" },
      capabilities: [], disclosures: ["Educational only; not financial advice."], acceptanceCriteria: ["Loads"], clarificationQuestions: [],
    },
    files: [{ path: "src/App.tsx", content: source }],
    bundle: { javascript, css: "", sha256: "a".repeat(64) },
    manifest: {
      schemaVersion: 2, entry: "src/App.tsx", capabilities: [], stateSchemaVersion: 1, allowedImports: ["react"],
      sourceBytes: new TextEncoder().encode(source).length,
      bundleBytes: new TextEncoder().encode(javascript).length,
    },
    validation: {
      passed: true,
      checks: [{ name: "Host preflight", passed: true, detail: "ok" }],
      issues: [],
      review: { passed: false, score: 0, issues: [], strengths: ["draft"], acceptanceResults: [] },
    },
    qualityTier: "draft",
    model: "gpt-5.6-terra",
    effort: "medium",
    complexity: { level: "simple", riskFlags: [], rationale: "test" },
    effortEscalations: [],
    tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    timings: { assessmentMs: 0, planningMs: 0, codingMs: 1, validationMs: 0, reviewMs: 0, totalMs: 1 },
    durationMs: 1,
    repairCount: 0,
    generatedAt: new Date().toISOString(),
    provenance: "test",
    capabilityToken: "x".repeat(32),
    artifactSignature: "x".repeat(43),
    ...overrides,
  };
}

describe("workspace artifact quality tiers", () => {
  it("accepts draft artifacts without review ≥90", () => {
    const parsed = workspaceArtifactSchema.safeParse(baseArtifact());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.qualityTier).toBe("draft");
  });

  it("rejects verified artifacts without a passing high review score", () => {
    const parsed = workspaceArtifactSchema.safeParse(baseArtifact({
      qualityTier: "verified",
      validation: {
        passed: true,
        checks: [{ name: "Sandbox", passed: true, detail: "ok" }],
        issues: [],
        review: { passed: false, score: 70, issues: ["weak"], strengths: [], acceptanceResults: [] },
      },
    }));
    expect(parsed.success).toBe(false);
  });

  it("accepts verified artifacts with review ≥90", () => {
    const parsed = workspaceArtifactSchema.safeParse(baseArtifact({
      qualityTier: "verified",
      validation: {
        passed: true,
        checks: [{ name: "Sandbox", passed: true, detail: "ok" }],
        issues: [],
        review: { passed: true, score: 92, issues: [], strengths: ["solid"], acceptanceResults: [] },
      },
    }));
    expect(parsed.success).toBe(true);
  });
});

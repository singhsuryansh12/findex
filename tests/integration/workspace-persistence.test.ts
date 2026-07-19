import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { WorkspaceArtifactV2 } from "@/lib/workspaces/contracts";
import {
  deleteWorkspaceProject,
  getWorkspaceArtifact,
  listWorkspaceProjects,
  listWorkspaceVersions,
  readWorkspaceState,
  renameWorkspaceProject,
  saveWorkspaceArtifact,
  writeWorkspaceState,
} from "@/lib/workspaces/persistence";

function artifact(projectId: string, version: number, parentVersionId: string | null): WorkspaceArtifactV2 {
  const id = crypto.randomUUID();
  const source = "export default function App(){return <main>Scenario</main>}";
  const javascript = "(()=>{})()";
  return {
    schemaVersion: 2,
    id,
    projectId,
    version,
    parentVersionId,
    restoredFromVersionId: null,
    title: "Adaptive scenario lab",
    prompt: "Build a scenario lab",
    plan: {
      schemaVersion: 2, intent: "create", title: "Adaptive scenario lab", goal: "Compare scenarios", response: "",
      assumptions: [], inputs: [], outputs: [], interactions: [], layout: ["responsive"], dataNeeds: [],
      persistence: { enabled: true, stateSchemaVersion: 1, description: "Saved scenario" },
      capabilities: ["workspace.state"], disclosures: ["Educational only"], acceptanceCriteria: ["Loads"], clarificationQuestions: [],
    },
    files: [{ path: "src/App.tsx", content: source }],
    bundle: { javascript, css: "", sha256: "a".repeat(64) },
    manifest: { schemaVersion: 2, entry: "src/App.tsx", capabilities: ["workspace.state"], stateSchemaVersion: 1, allowedImports: ["react"], sourceBytes: new TextEncoder().encode(source).length, bundleBytes: new TextEncoder().encode(javascript).length },
    validation: { passed: true, checks: [{ name: "test", passed: true, detail: "passed" }], issues: [], review: { passed: true, score: 100, issues: [], strengths: [], acceptanceResults: [] } },
    model: "gpt-5.6-sol", effort: "low", complexity: { level: "simple", riskFlags: [], rationale: "test" }, effortEscalations: [],
    tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, durationMs: 1, repairCount: 0,
    timings: { assessmentMs: 0, planningMs: 0, codingMs: 0, validationMs: 0, reviewMs: 0, totalMs: 1 },
    generatedAt: new Date().toISOString(), provenance: "test", capabilityToken: "x".repeat(32),
    artifactSignature: "x".repeat(43),
  };
}

describe("browser workspace library", () => {
  it("stores immutable versions and updates the active project head", async () => {
    const projectId = crypto.randomUUID();
    const first = artifact(projectId, 1, null);
    const second = artifact(projectId, 2, first.id);
    await saveWorkspaceArtifact(first);
    await saveWorkspaceArtifact(second);
    await expect(saveWorkspaceArtifact(first)).rejects.toThrow();
    const projects = await listWorkspaceProjects();
    expect(projects.find((project) => project.id === projectId)).toMatchObject({ activeVersionId: second.id, name: second.title });
    expect((await listWorkspaceVersions(projectId)).map((version) => version.version)).toEqual([2, 1]);
    await expect(getWorkspaceArtifact(first.id)).resolves.toMatchObject({ id: first.id, version: 1 });
  });

  it("persists namespaced generated-tool state and removes it with the project", async () => {
    const projectId = crypto.randomUUID();
    const saved = artifact(projectId, 1, null);
    await saveWorkspaceArtifact(saved);
    await renameWorkspaceProject(projectId, "Renamed planner");
    expect((await listWorkspaceProjects()).find((project) => project.id === projectId)?.name).toBe("Renamed planner");
    await writeWorkspaceState(projectId, "scenario.rate", { value: 7.5 });
    await expect(readWorkspaceState(projectId, "scenario.rate")).resolves.toEqual({ found: true, value: { value: 7.5 } });
    await deleteWorkspaceProject(projectId);
    expect((await listWorkspaceProjects()).some((project) => project.id === projectId)).toBe(false);
    await expect(readWorkspaceState(projectId, "scenario.rate")).resolves.toEqual({ found: false, value: null });
  });

  it("rejects generated state values over 64 KB", async () => {
    await expect(writeWorkspaceState(crypto.randomUUID(), "too-big", "x".repeat(70_000))).rejects.toThrow("64 KB");
  });
});

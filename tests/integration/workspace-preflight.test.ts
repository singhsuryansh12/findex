import type OpenAI from "openai";
import type { Responses } from "openai/resources/responses/responses";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceBuildPlan, WorkspaceFile } from "@/lib/workspaces/contracts";
import { buildWorkspaceDraft } from "@/lib/workspaces/generator";
import { quickCheckWorkspace, validateAndBundleWorkspace } from "@/lib/workspaces/sandbox";

const badStateSource = `import React from "react";
import { useWorkspaceState } from "@findex/workspace-sdk";
export default function App() {
  const [scenario] = useWorkspaceState<{ annualSpend: number }>({ annualSpend: 60000 });
  return <main><h1>FIRE planner</h1><output>{scenario.annualSpend * 25}</output><p>Educational, not financial advice.</p></main>;
}`;

const goodStateSource = badStateSource.replace(
  "useWorkspaceState<{ annualSpend: number }>({ annualSpend: 60000 })",
  "useWorkspaceState<{ annualSpend: number }>(\"fire-planner\", { annualSpend: 60000 })",
);

const styles: WorkspaceFile = { path: "src/styles.css", content: "main{max-width:50rem;margin:auto;padding:1rem}" };

function firePlan(): WorkspaceBuildPlan {
  return {
    schemaVersion: 2,
    intent: "create",
    title: "FIRE planner",
    goal: "Plan financial independence",
    response: "",
    assumptions: ["4% withdrawal rate"],
    inputs: [{ id: "annualSpend", label: "Annual spending", type: "currency", description: "Annual retirement spending", required: true, defaultValue: "60000" }],
    outputs: [{ id: "target", label: "FIRE target", description: "Annual spending divided by withdrawal rate", format: "USD" }],
    interactions: ["Annual spending updates the FIRE target"],
    layout: ["Responsive calculator"],
    dataNeeds: [],
    persistence: { enabled: true, stateSchemaVersion: 1, description: "Save the scenario" },
    capabilities: ["workspace.state"],
    disclosures: ["Educational information only; not financial advice."],
    acceptanceCriteria: ["Changing annual spending updates the target"],
    clarificationQuestions: [],
  };
}

function toolResponse(id: string, name: string, args: Record<string, unknown>) {
  return {
    id,
    status: "completed",
    output: [{ type: "function_call", id: `${id}_item`, call_id: `${id}_call`, name, arguments: JSON.stringify(args), status: "completed" }],
    incomplete_details: null,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  } as unknown as Responses.Response;
}

describe("workspace builder preflight parity", () => {
  it("forces a bounded first tool and preserves response metadata when the contract is violated", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const create = vi.fn().mockResolvedValue({
      id: "resp_text_only",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "Here is your workspace." }] }],
      incomplete_details: null,
      usage: { input_tokens: 21, output_tokens: 34, total_tokens: 55 },
    } as unknown as Responses.Response);
    const client = { responses: { create } } as unknown as OpenAI;

    await expect(buildWorkspaceDraft({
      client,
      plan: firePlan(),
      assessment: { level: "standard", riskFlags: [], rationale: "Editable retirement assumptions" },
      active: null,
      requestId: "tool-contract-regression",
    })).rejects.toMatchObject({
      code: "PLAN_INVALID",
      metadata: {
        responseId: "resp_text_only",
        responseStatus: "completed",
        usage: { inputTokens: 21, outputTokens: 34, totalTokens: 55 },
      },
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ tool_choice: { type: "function", name: "list_files" }, parallel_tool_calls: false });
    expect(create.mock.calls[1]?.[0]).toMatchObject({ tool_choice: { type: "function", name: "list_files" }, previous_response_id: "resp_text_only" });
  });

  it("retries one explicit transient provider failure without changing model or reasoning", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const create = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("temporary provider failure"), { status: 500, code: "server_error" }))
      .mockResolvedValueOnce(toolResponse("resp_write", "write_file", { path: "src/App.tsx", content: goodStateSource }))
      .mockResolvedValueOnce(toolResponse("resp_check", "run_check", { check: "policy_typecheck_and_bundle" }))
      .mockResolvedValueOnce(toolResponse("resp_finish", "finish_workspace", { summary: "Validated FIRE planner" }));
    const client = { responses: { create } } as unknown as OpenAI;

    await expect(buildWorkspaceDraft({
      client,
      plan: firePlan(),
      assessment: { level: "standard", riskFlags: [], rationale: "Editable retirement assumptions" },
      active: null,
      requestId: "transient-build-regression",
    })).resolves.toMatchObject({ model: "gpt-5.6-terra", effort: "medium" });

    expect(create).toHaveBeenCalledTimes(4);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: "gpt-5.6-terra", reasoning: { effort: "medium" }, tool_choice: { type: "function", name: "list_files" } });
    expect(create.mock.calls[1]?.[0]).toMatchObject({ model: "gpt-5.6-terra", reasoning: { effort: "medium" }, tool_choice: { type: "function", name: "list_files" } });
  });

  it("classifies an exhausted build signal as timeout even when the provider error name is minified", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const create = vi.fn().mockRejectedValue(Object.assign(new Error("bundled abort"), { name: "g" }));
    const client = { responses: { create } } as unknown as OpenAI;
    const signal = AbortSignal.abort(new DOMException("The operation timed out", "TimeoutError"));

    await expect(buildWorkspaceDraft({
      client,
      plan: firePlan(),
      assessment: { level: "standard", riskFlags: [], rationale: "Editable retirement assumptions" },
      active: null,
      requestId: "minified-timeout-regression",
      signal,
    })).rejects.toMatchObject({ code: "PLAN_TIMEOUT" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("returns the actionable SDK compiler diagnostic for the exact one-argument regression", async () => {
    const result = await quickCheckWorkspace([{ path: "src/App.tsx", content: badStateSource }, styles]);
    expect(result.passed).toBe(false);
    expect(result).toMatchObject({ code: "WORKSPACE_TYPECHECK_FAILED" });
    expect(result.diagnostics.join("\n")).toMatch(/TS2554: Expected 2 arguments, but got 1/);
    expect(result.diagnostics.join("\n")).toContain("src/App.tsx");
  });

  it("passes strict TypeScript and bundling after the SDK call is corrected", async () => {
    await expect(quickCheckWorkspace([{ path: "src/App.tsx", content: goodStateSource }, styles])).resolves.toMatchObject({
      passed: true,
      diagnostics: [expect.stringContaining("Strict TypeScript and bundle checks passed")],
    });
  });

  it("preserves the same actionable compiler output through the final local validator", async () => {
    await expect(validateAndBundleWorkspace(
      [{ path: "src/App.tsx", content: badStateSource }, styles],
      "standard",
      firePlan(),
    )).rejects.toMatchObject({
      code: "WORKSPACE_TYPECHECK_FAILED",
      actionable: true,
      diagnostics: [expect.stringMatching(/src\/App\.tsx.*TS2554.*Expected 2 arguments, but got 1/)],
    });
  }, 30_000);

  it("feeds compiler output back to the builder and refuses finish until the corrected source passes", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(toolResponse("resp_write", "write_file", { path: "src/App.tsx", content: badStateSource }))
      .mockResolvedValueOnce(toolResponse("resp_bad_check", "run_check", { check: "policy_typecheck_and_bundle" }))
      .mockImplementationOnce(async (request: { input: Responses.ResponseInput }) => {
        expect(JSON.stringify(request.input)).toMatch(/TS2554.*Expected 2 arguments, but got 1/);
        return toolResponse("resp_early_finish", "finish_workspace", { summary: "Done" });
      })
      .mockImplementationOnce(async (request: { input: Responses.ResponseInput }) => {
        expect(JSON.stringify(request.input)).toContain("latest source has not passed strict TypeScript validation");
        return toolResponse("resp_patch", "patch_file", {
          path: "src/App.tsx",
          replacements: [{
            oldText: "useWorkspaceState<{ annualSpend: number }>({ annualSpend: 60000 })",
            newText: "useWorkspaceState<{ annualSpend: number }>(\"fire-planner\", { annualSpend: 60000 })",
          }],
        });
      })
      .mockResolvedValueOnce(toolResponse("resp_good_check", "run_check", { check: "policy_typecheck_and_bundle" }))
      .mockResolvedValueOnce(toolResponse("resp_finish", "finish_workspace", { summary: "Validated FIRE planner" }));
    const client = { responses: { create } } as unknown as OpenAI;

    const result = await buildWorkspaceDraft({
      client,
      plan: firePlan(),
      assessment: { level: "standard", riskFlags: [], rationale: "Editable retirement assumptions" },
      active: null,
      files: [{ path: "src/App.tsx", content: "export default function App(){return <main>Draft</main>}" }, styles],
      requestId: "preflight-regression",
    });

    expect(create).toHaveBeenCalledTimes(6);
    expect(result.files.find((file) => file.path === "src/App.tsx")?.content).toContain("useWorkspaceState<{ annualSpend: number }>(\"fire-planner\"");
  }, 30_000);

  it("invalidates a successful check when source changes before finish", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(toolResponse("resp_write", "write_file", { path: "src/App.tsx", content: goodStateSource }))
      .mockResolvedValueOnce(toolResponse("resp_check", "run_check", { check: "policy_typecheck_and_bundle" }))
      .mockResolvedValueOnce(toolResponse("resp_mutate", "patch_file", {
        path: "src/App.tsx",
        replacements: [{ oldText: "<h1>FIRE planner</h1>", newText: "<h1>FIRE retirement planner</h1>" }],
      }))
      .mockResolvedValueOnce(toolResponse("resp_stale_finish", "finish_workspace", { summary: "Done" }))
      .mockImplementationOnce(async (request: { input: Responses.ResponseInput }) => {
        expect(JSON.stringify(request.input)).toContain("latest source has not passed strict TypeScript validation");
        return toolResponse("resp_recheck", "run_check", { check: "policy_typecheck_and_bundle" });
      })
      .mockResolvedValueOnce(toolResponse("resp_finish", "finish_workspace", { summary: "Validated after final edit" }));
    const client = { responses: { create } } as unknown as OpenAI;

    const result = await buildWorkspaceDraft({
      client,
      plan: firePlan(),
      assessment: { level: "standard", riskFlags: [], rationale: "Editable retirement assumptions" },
      active: null,
      files: [{ path: "src/App.tsx", content: "export default function App(){return <main>Draft</main>}" }, styles],
      requestId: "stale-check-regression",
    });

    expect(create).toHaveBeenCalledTimes(6);
    expect(result.files.find((file) => file.path === "src/App.tsx")?.content).toContain("FIRE retirement planner");
  }, 30_000);
});

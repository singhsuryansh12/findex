import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { BuildComplexityAssessment, WorkspaceBuildPlan, WorkspaceFile } from "@/lib/workspaces/contracts";
import { validateAndBundleWorkspace } from "@/lib/workspaces/sandbox";
import { WorkspaceValidationError } from "@/lib/workspaces/validation-errors";

const runId = process.env.WORKFLOW_REPLAY_RUN_ID;
const expectedFailure = process.env.WORKFLOW_REPLAY_EXPECT_FAILURE === "1";
const expectedDiagnostics = process.env.WORKFLOW_REPLAY_EXPECT_DIAGNOSTICS?.split("|").filter(Boolean) ?? [
  "accessible label/help text does not identify its unit",
  "Save must be disabled while assumptions are invalid",
  "not a multi-output summary",
];
const run = promisify(execFile);

function jsonFromCli(output: string) {
  const start = output.indexOf("{");
  if (start < 0) throw new Error("Workflow CLI did not return JSON.");
  return JSON.parse(output.slice(start)) as Record<string, unknown>;
}

describe.skipIf(!runId)("saved local Workflow replay", () => {
  it("revalidates the last generated draft without another model request", async () => {
    const { stdout: listedOutput } = await run("./node_modules/.bin/workflow", [
      "inspect", "steps", "--runId", runId!, "--json", "--sort", "asc",
    ], { cwd: process.cwd(), maxBuffer: 12 * 1024 * 1024 });
    const listedStart = listedOutput.indexOf("[");
    if (listedStart < 0) throw new Error("Workflow CLI did not return a step list.");
    const steps = JSON.parse(listedOutput.slice(listedStart)) as Array<{ stepId: string; stepName: string }>;
    const build = [...steps].reverse().find((step) => step.stepName.endsWith("//buildStep"));
    if (!build) throw new Error("The Workflow run does not contain a completed build step.");

    const { stdout: buildOutput } = await run("./node_modules/.bin/workflow", [
      "inspect", "step", build.stepId, "--json",
    ], { cwd: process.cwd(), maxBuffer: 12 * 1024 * 1024 });
    const record = jsonFromCli(buildOutput) as {
      input?: { args?: [
        { plan?: WorkspaceBuildPlan; assessment?: BuildComplexityAssessment },
        ...unknown[],
      ] };
      output?: { files?: WorkspaceFile[] };
    };
    const plan = record.input?.args?.[0]?.plan;
    const assessment = record.input?.args?.[0]?.assessment;
    const files = record.output?.files;
    if (!plan || !assessment || !files?.length) throw new Error("The Workflow build step is missing its plan, assessment, or generated files.");

    if (expectedFailure) {
      try {
        await validateAndBundleWorkspace(files, assessment.level, plan);
        throw new Error("Expected the saved workspace to fail the current host validation contract.");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkspaceValidationError);
        const diagnostics = (error as WorkspaceValidationError).diagnostics.join("\n");
        for (const expected of expectedDiagnostics) expect(diagnostics).toContain(expected);
      }
      return;
    }

    const result = await validateAndBundleWorkspace(files, assessment.level, plan);
    expect(result.executor).toBe("local");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "TypeScript", passed: true }),
      expect.objectContaining({ name: "Chromium interaction", passed: true }),
      expect.objectContaining({ name: "Production bundle", passed: true }),
    ]));
  }, 240_000);
});

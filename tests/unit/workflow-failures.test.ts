import { describe, expect, it } from "vitest";
import { WorkspaceModelError } from "@/lib/workspaces/openai-response";
import { buildFailureMessage, safeFailureMessage, userMessageForModelCode } from "@/lib/workspaces/workflow-failures";

describe("workflow failure message preservation", () => {
  it("keeps direct Findex Error messages", () => {
    expect(safeFailureMessage(new Error("Findex couldn't validate the repaired workspace (TYPESCRIPT); nothing was published.")))
      .toContain("couldn't validate the repaired workspace");
  });

  it("unwraps Workflow-style wrappers that bury the Findex message", () => {
    const wrapped = new Error("[Workflow] Max retries reached, bubbling error to parent workflow");
    (wrapped as Error & { cause: Error }).cause = new WorkspaceModelError(
      "PLAN_INVALID",
      "Findex could not finish the workspace source pass.",
    );
    expect(safeFailureMessage(wrapped)).toBe("Findex could not finish the workspace source pass.");
  });

  it("extracts Findex text from a serialized stack-like message", () => {
    const wrapped = new Error(
      "Error: WorkspaceModelError: Findex could not finish the workspace source pass.\n    at runBuilderPass",
    );
    expect(safeFailureMessage(wrapped)).toBe("Findex could not finish the workspace source pass.");
  });

  it("maps model codes when the message lost its Findex prefix", () => {
    expect(userMessageForModelCode("MODEL_TRANSIENT")).toMatch(/temporary model service error/);
    expect(buildFailureMessage(new WorkspaceModelError("MODEL_FAILED", "provider blew up"))).toMatch(/couldn't complete the workspace build/);
  });

  it("falls back to the generic line for unknown noise", () => {
    expect(safeFailureMessage(new Error("ECONNRESET"))).toBe("Findex couldn't finish this workspace; nothing was published.");
  });
});

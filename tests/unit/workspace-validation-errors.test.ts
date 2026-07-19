import { describe, expect, it } from "vitest";
import {
  canRepairWorkspaceValidation,
  commandValidationFailure,
  hasActionableWorkspaceDiagnostics,
  sanitizeWorkspaceDiagnostic,
  validationFailureFrom,
  WorkspaceValidationError,
} from "@/lib/workspaces/validation-errors";

describe("workspace validation diagnostics", () => {
  it("preserves actionable TypeScript output while removing paths, ANSI, and secrets", () => {
    const root = "/private/tmp/findex-workspace-secret";
    const failure = commandValidationFailure({
      script: "typecheck",
      workspaceRoot: root,
      error: Object.assign(new Error("Command failed"), {
        stdout: `\u001b[31m${root}/src/App.tsx(12,29): error TS2554: Expected 2 arguments, but got 1.\u001b[0m\nOPENAI_API_KEY=sk-proj-thismustberedacted`,
        stderr: "",
      }),
    });

    expect(failure).toMatchObject({
      code: "WORKSPACE_TYPECHECK_FAILED",
      actionable: true,
      platformTransient: false,
    });
    expect(failure.diagnostics[0]).toContain("<workspace>/src/App.tsx(12,29): error TS2554");
    expect(failure.diagnostics[0]).toContain("[REDACTED]");
    expect(failure.diagnostics[0]).not.toContain(root);
    expect(failure.diagnostics[0]).not.toContain("sk-proj-thismustberedacted");
    expect(failure.diagnostics[0]).not.toContain("\u001b");
  });

  it("does not authorize a paid repair when a command has no useful diagnostic", () => {
    const failure = commandValidationFailure({ script: "typecheck", error: new Error("Command failed: npm run typecheck") });
    expect(failure.actionable).toBe(false);
    expect(hasActionableWorkspaceDiagnostics(failure.diagnostics)).toBe(false);
    expect(canRepairWorkspaceValidation(failure)).toBe(false);
  });

  it("does not mistake stack-trace line numbers for HTTP 5xx platform errors", () => {
    const failure = commandValidationFailure({
      script: "bundle",
      error: Object.assign(new Error("Build failed"), {
        stderr: "src/App.tsx:1:38: ERROR: Could not resolve react\n    at readable:568:12\n    at main.js:1748:15",
      }),
    });
    expect(failure).toMatchObject({
      code: "WORKSPACE_BUNDLE_FAILED",
      actionable: true,
      platformTransient: false,
    });
    expect(canRepairWorkspaceValidation(failure)).toBe(true);
  });

  it("treats browser acceptance failures as actionable source validation", () => {
    const failure = commandValidationFailure({
      script: "test",
      error: Object.assign(new Error("Tests failed"), {
        stdout: "Error: expect(locator).toBeVisible() failed\nLocator: getByLabel('FIRE target')\nExpected: visible\nError: element(s) not found",
      }),
    });
    expect(failure).toMatchObject({
      code: "WORKSPACE_TEST_FAILED",
      actionable: true,
      platformTransient: false,
    });
    expect(canRepairWorkspaceValidation(failure)).toBe(true);
  });

  it("classifies aborts and platform transients as non-actionable capacity failures", () => {
    const aborted = new DOMException("The operation timed out", "TimeoutError");
    expect(validationFailureFrom(aborted)).toMatchObject({
      code: "WORKSPACE_VALIDATION_TIMEOUT",
      actionable: false,
      platformTransient: true,
    });
    expect(validationFailureFrom(new Error("Sandbox connection ETIMEDOUT"))).toMatchObject({
      code: "WORKSPACE_PLATFORM_FAILED",
      actionable: false,
      platformTransient: true,
    });
    expect(canRepairWorkspaceValidation(validationFailureFrom(aborted))).toBe(false);
  });

  it("round-trips structured source failures without reducing their diagnostics to Error.message", () => {
    const error = new WorkspaceValidationError({
      code: "WORKSPACE_TYPECHECK_FAILED",
      diagnostics: ["src/App.tsx(8,10): error TS2554: Expected 2 arguments, but got 1."],
      actionable: true,
      platformTransient: false,
    }, "Workspace typecheck validation failed.");
    expect(validationFailureFrom(error)).toEqual({
      code: "WORKSPACE_TYPECHECK_FAILED",
      diagnostics: ["src/App.tsx(8,10): error TS2554: Expected 2 arguments, but got 1."],
      actionable: true,
      platformTransient: false,
    });
    expect(canRepairWorkspaceValidation(validationFailureFrom(error))).toBe(true);
  });

  it("bounds oversized diagnostic payloads", () => {
    const diagnostic = sanitizeWorkspaceDiagnostic(`src/App.tsx(1,1): error TS9999: ${"x".repeat(20_000)}`);
    expect(diagnostic.length).toBeLessThanOrEqual(12_000);
    expect(diagnostic).toContain("diagnostic truncated");
  });
});

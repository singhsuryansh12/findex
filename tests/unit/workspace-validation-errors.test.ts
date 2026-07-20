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

  it("treats a missing TypeScript binary as a non-actionable platform failure", () => {
    const failure = commandValidationFailure({
      script: "typecheck",
      error: Object.assign(new Error("Command failed"), {
        stdout: "> typecheck\n> tsc --noEmit\n",
        stderr: "sh: line 1: tsc: command not found\n",
      }),
    });
    expect(failure).toMatchObject({
      code: "WORKSPACE_PLATFORM_FAILED",
      actionable: false,
      platformTransient: true,
    });
  });

  it("treats Next.js [externals] typescript resolve paths as platform failures", () => {
    const failure = commandValidationFailure({
      script: "typecheck",
      error: Object.assign(new Error("Command failed"), {
        stdout: "",
        stderr: "Error: Cannot find module '<workspace>/[externals]/typescript/lib/tsc.js [external] (typescript/lib/tsc.js, cjs, [project]/node_modules/typescript)'\n",
      }),
    });
    expect(failure).toMatchObject({
      code: "WORKSPACE_PLATFORM_FAILED",
      actionable: false,
      platformTransient: true,
    });
  });

  it("treats missing host @types packages as platform failures", () => {
    const failure = commandValidationFailure({
      script: "typecheck",
      error: Object.assign(new Error("Command failed"), {
        stdout: "error TS2688: Cannot find type definition file for 'node'.\nerror TS2688: Cannot find type definition file for 'vitest/globals'.\n",
        stderr: "",
      }),
    });
    expect(failure).toMatchObject({
      code: "WORKSPACE_PLATFORM_FAILED",
      actionable: false,
      platformTransient: true,
    });
  });

  it("treats missing React declaration files on the host as platform failures", () => {
    const failure = commandValidationFailure({
      script: "typecheck",
      error: Object.assign(new Error("Command failed"), {
        stdout: "src/App.tsx(1,36): error TS7016: Could not find a declaration file for module 'react'.\nsrc/App.tsx(6,10): error TS7026: JSX element implicitly has type 'any' because no interface 'JSX.IntrinsicElements' exists.\n",
        stderr: "",
      }),
    });
    expect(failure).toMatchObject({
      code: "WORKSPACE_PLATFORM_FAILED",
      actionable: false,
      platformTransient: true,
    });
  });

  it("prefers the host quality-contract error over Playwright runner noise", () => {
    const stdout = `
> test
> vitest run && playwright test

Running 1 test using 1 worker
✘ 1 workspace.e2e.ts:388:1 › renders, exercises controls, and remains responsive (29.9s)

  Error: Workspace quality contract failed.
  Missing controls: Current age; Annual spending.
  Annual spending: accessible label/help text does not identify its unit.
  WCAG color-contrast: Elements must have sufficient color contrast

    at /tmp/findex-workspace-abc/workspace.e2e.ts:459:11
`;
    const failure = commandValidationFailure({
      script: "test",
      error: Object.assign(new Error("npm run test failed."), { stdout, stderr: "" }),
    });
    expect(failure.code).toBe("WORKSPACE_TEST_FAILED");
    expect(failure.actionable).toBe(true);
    expect(failure.diagnostics[0]).toContain("Missing controls: Current age; Annual spending.");
    expect(failure.diagnostics[0]).toContain("accessible label/help text does not identify its unit");
    expect(failure.diagnostics[0]).not.toContain("vitest run && playwright test");
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

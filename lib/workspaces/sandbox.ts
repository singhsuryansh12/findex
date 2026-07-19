import "server-only";

import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { Sandbox } from "@vercel/sandbox";
import { bundleWorkspace, type WorkspaceBundle } from "./bundle";
import type { BuildComplexityLevel, WorkspaceBuildPlan, WorkspaceFile, WorkspaceValidationReport } from "./contracts";
import { validateWorkspaceFiles } from "./policy";

const exec = promisify(execFile);
const sandboxTemplateRoot = join(process.cwd(), "infrastructure", "workspace-sandbox");
const localValidationFiles = [
  "package.json",
  "tsconfig.json",
  "build.mjs",
  "preview.tsx",
  "server.mjs",
  "playwright.config.ts",
  "vitest.config.ts",
  "workspace.e2e.ts",
  "src/workspace-sdk.d.ts",
  "src/workspace.test.ts",
];

export type SandboxValidation = {
  bundle: WorkspaceBundle;
  checks: WorkspaceValidationReport["checks"];
  issues: string[];
  executor: "local" | "vercel";
  screenshots?: { desktop: string; mobile: string };
};

async function validateLocally(
  files: WorkspaceFile[],
  plan: WorkspaceBuildPlan,
  budgetMs: number,
  signal?: AbortSignal,
): Promise<SandboxValidation> {
  const policy = validateWorkspaceFiles(files);
  if (!policy.passed) throw new Error(policy.issues.join("\n"));
  const root = await mkdtemp(join(tmpdir(), "findex-workspace-"));
  try {
    for (const file of files) {
      const destination = join(root, file.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.content, "utf8");
    }
    for (const relativePath of localValidationFiles) {
      const destination = join(root, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await readFile(join(sandboxTemplateRoot, relativePath), "utf8"), "utf8");
    }
    await writeFile(join(root, "workspace-plan.json"), JSON.stringify(plan), "utf8");
    await symlink(join(process.cwd(), "node_modules"), join(root, "node_modules"), "dir");
    const environment = { ...process.env, WORKSPACE_PREVIEW_PORT: String(randomInt(42_000, 52_000)) };
    const run = (script: string, timeout: number) => exec("npm", ["run", script], {
      cwd: root,
      env: environment,
      timeout: Math.min(timeout, budgetMs),
      maxBuffer: 4 * 1024 * 1024,
      signal,
    });
    await run("typecheck", 45_000);
    await run("bundle", 60_000);
    await run("test", 90_000);
    const [desktop, mobile] = await Promise.all([
      readFile(join(root, "test-results", "workspace-desktop.png")),
      readFile(join(root, "test-results", "workspace-mobile.png")),
    ]);
    const bundle = await bundleWorkspace(files);
    return {
      bundle,
      executor: "local",
      screenshots: { desktop: desktop.toString("base64"), mobile: mobile.toString("base64") },
      issues: [],
      checks: [
        ...policy.checks,
        { name: "TypeScript", passed: true, detail: "Strict TypeScript check passed in the local parity runner." },
        { name: "Sandbox tests", passed: true, detail: "Host-owned Vitest acceptance checks passed." },
        { name: "Chromium interaction", passed: true, detail: "Every planned input changed rendered output without console errors or desktop/mobile overflow." },
        { name: "Production bundle", passed: true, detail: `${bundle.bytes.toLocaleString()} byte local parity bundle` },
      ],
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function commandResult(sandbox: Sandbox, command: string, args: string[], timeoutMs: number, signal?: AbortSignal) {
  const result = await sandbox.runCommand(command, args, { timeoutMs, signal });
  const stdout = await result.stdout();
  const stderr = await result.stderr();
  if (result.exitCode !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${stdout}\n${stderr}`.trim());
  return stdout;
}

async function validateInVercel(
  files: WorkspaceFile[],
  plan: WorkspaceBuildPlan,
  budgetMs: number,
  signal?: AbortSignal,
): Promise<SandboxValidation> {
  const snapshotId = process.env.VERCEL_SANDBOX_SNAPSHOT_ID;
  if (!snapshotId) throw new Error("VERCEL_SANDBOX_SNAPSHOT_ID is required for hosted workspace generation.");
  const policy = validateWorkspaceFiles(files);
  if (!policy.passed) throw new Error(policy.issues.join("\n"));
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId },
    timeout: Math.min(budgetMs, 250_000),
    networkPolicy: "deny-all",
    signal,
  });
  try {
    await sandbox.writeFiles([
      ...files.map((file) => ({ path: file.path, content: file.content })),
      { path: "workspace-plan.json", content: JSON.stringify(plan) },
    ], { signal });
    await commandResult(sandbox, "npm", ["run", "typecheck"], 45_000, signal);
    await commandResult(sandbox, "npm", ["run", "bundle"], 60_000, signal);
    await commandResult(sandbox, "npm", ["run", "test"], 90_000, signal);
    const [desktop, mobile] = await Promise.all([
      sandbox.fs.readFile("test-results/workspace-desktop.png", { signal }),
      sandbox.fs.readFile("test-results/workspace-mobile.png", { signal }),
    ]);
    // The untrusted source was typechecked, tested, and bundled in the network-denied
    // microVM. Publication uses the host-owned runtime wrapper so generated code can
    // communicate only through the validated capability bridge.
    const bundle = await bundleWorkspace(files);
    return {
      bundle,
      executor: "vercel",
      screenshots: { desktop: desktop.toString("base64"), mobile: mobile.toString("base64") },
      issues: [],
      checks: [
        ...policy.checks,
        { name: "TypeScript", passed: true, detail: "Strict TypeScript check passed in Vercel Sandbox." },
        { name: "Sandbox tests", passed: true, detail: "Generated tests passed with outbound networking denied." },
        { name: "Chromium interaction", passed: true, detail: "Every planned input changed rendered output without console errors or desktop/mobile overflow." },
        { name: "Production bundle", passed: true, detail: `${bundle.bytes.toLocaleString()} byte sandbox bundle` },
      ],
    };
  } finally {
    await sandbox.stop({ signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  }
}

export function workspaceExecutionMode() {
  const requested = process.env.WORKSPACE_EXECUTION_MODE;
  if (requested === "local" || requested === "vercel" || requested === "disabled") return requested;
  return process.env.NODE_ENV === "production" ? "vercel" : "local";
}

export async function validateAndBundleWorkspace(
  files: WorkspaceFile[],
  complexity: BuildComplexityLevel,
  plan: WorkspaceBuildPlan,
  signal?: AbortSignal,
) {
  const mode = workspaceExecutionMode();
  if (mode === "disabled") throw new Error("Live workspace generation is disabled. No fallback workspace was substituted.");
  const budgetMs = complexity === "simple" ? 90_000 : complexity === "standard" ? 160_000 : 240_000;
  return mode === "vercel" ? validateInVercel(files, plan, budgetMs, signal) : validateLocally(files, plan, budgetMs, signal);
}

export async function quickCheckWorkspace(files: WorkspaceFile[]) {
  const policy = validateWorkspaceFiles(files);
  if (!policy.passed) return { passed: false, diagnostics: policy.issues };
  try {
    const bundle = await bundleWorkspace(files);
    return { passed: true, diagnostics: [`Bundle passed (${bundle.bytes.toLocaleString()} bytes).`] };
  } catch (error) {
    return { passed: false, diagnostics: [error instanceof Error ? error.message : "Bundle failed."] };
  }
}

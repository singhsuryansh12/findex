import "server-only";

import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { Sandbox } from "@vercel/sandbox";
import {
  bundleWorkspace,
  canResolveWorkspaceHostPackages,
  isMissingHostBundlerPackages,
  sandboxPublishBuildSource,
  workspaceBundleFromPublishArtifacts,
  type WorkspaceBundle,
} from "./bundle";
import type { BuildComplexityLevel, WorkspaceBuildPlan, WorkspaceFile, WorkspaceValidationReport } from "./contracts";
import { validateWorkspaceFiles } from "./policy";
import { commandValidationFailure, validationFailureFrom, WorkspaceValidationError } from "./validation-errors";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const sandboxTemplateRoot = join(process.cwd(), "infrastructure", "workspace-sandbox");

function isRunnableTypeScriptCompiler(path: string) {
  return Boolean(path)
    && !path.includes("[externals]")
    && !path.includes("(typescript/")
    && existsSync(path);
}

function resolveTypeScriptCompiler() {
  const cwdCandidate = join(process.cwd(), "node_modules", "typescript", "lib", "tsc.js");
  if (isRunnableTypeScriptCompiler(cwdCandidate)) return cwdCandidate;
  try {
    const resolved = require.resolve("typescript/lib/tsc.js");
    if (isRunnableTypeScriptCompiler(resolved)) return resolved;
  } catch {
    // Fall through.
  }
  return null;
}

function isMissingTypeScriptToolchain(error: unknown) {
  const parts = [
    error instanceof Error ? error.message : String(error ?? ""),
    typeof error === "object" && error && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "",
    typeof error === "object" && error && "stdout" in error ? String((error as { stdout?: unknown }).stdout ?? "") : "",
    error instanceof WorkspaceValidationError ? error.diagnostics.join("\n") : "",
  ];
  return /tsc:\s*command not found|not found: tsc|Cannot find module ['"]?typescript|MODULE_NOT_FOUND.*typescript|\[externals\].*typescript\/lib\/tsc|TypeScript compiler is unavailable|TS2688:\s*Cannot find type definition file for ['"](?:node|vitest\/globals)['"]|TS7016:\s*Could not find a declaration file for module ['"]react(?:\/jsx-runtime)?['"]|Could not find a declaration file for module ['"]react(?:-dom)?['"]|JSX element implicitly has type 'any' because no interface 'JSX\.IntrinsicElements' exists|Try `npm i --save-dev @types\/react`/i.test(parts.join("\n"));
}

function isHostToolchainGap(error: unknown) {
  return isMissingTypeScriptToolchain(error) || isMissingHostBundlerPackages(error);
}

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

/** Host harness files safe to refresh inside an immutable snapshot without npm install. */
const vercelHarnessRefreshFiles = [
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

async function materializeWorkspaceSource(root: string, files: WorkspaceFile[]) {
  for (const file of files) {
    const destination = join(root, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content, "utf8");
  }
}

async function runLocalScript(options: {
  root: string;
  script: "typecheck" | "bundle" | "test";
  timeoutMs: number;
  budgetMs: number;
  environment: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}) {
  try {
    return await exec("npm", ["run", options.script], {
      cwd: options.root,
      env: options.environment,
      timeout: Math.min(options.timeoutMs, options.budgetMs),
      maxBuffer: 4 * 1024 * 1024,
      signal: options.signal,
    });
  } catch (error) {
    throw new WorkspaceValidationError(commandValidationFailure({
      script: options.script,
      error,
      workspaceRoot: options.root,
    }), `Workspace ${options.script} validation failed.`);
  }
}

async function strictTypecheckWorkspace(files: WorkspaceFile[], signal?: AbortSignal) {
  const tscJs = resolveTypeScriptCompiler();
  if (!tscJs) {
    throw new WorkspaceValidationError({
      code: "WORKSPACE_PLATFORM_FAILED",
      diagnostics: ["TypeScript compiler is unavailable in this runtime."],
      actionable: false,
      platformTransient: true,
    }, "Workspace typecheck validation failed.");
  }
  const root = await mkdtemp(join(tmpdir(), "findex-workspace-preflight-"));
  try {
    await materializeWorkspaceSource(root, files);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "package.json"), await readFile(join(sandboxTemplateRoot, "package.json"), "utf8"), "utf8");
    await writeFile(join(root, "src", "workspace-sdk.d.ts"), await readFile(join(sandboxTemplateRoot, "src/workspace-sdk.d.ts"), "utf8"), "utf8");
    // Host preflight must not require @types/node or vitest/globals — those are
    // sandbox-only (and often omitted from production serverless installs).
    await writeFile(join(root, "tsconfig.json"), await readFile(join(sandboxTemplateRoot, "tsconfig.preflight.json"), "utf8"), "utf8");
    await symlink(join(process.cwd(), "node_modules"), join(root, "node_modules"), "dir");
    // Invoke tsc through node so serverless PATH does not need a global binary.
    try {
      await exec(process.execPath, [tscJs, "--noEmit", "-p", root], {
        cwd: root,
        env: { ...process.env },
        timeout: 45_000,
        maxBuffer: 4 * 1024 * 1024,
        signal,
      });
    } catch (error) {
      throw new WorkspaceValidationError(commandValidationFailure({
        script: "typecheck",
        error,
        workspaceRoot: root,
      }), "Workspace typecheck validation failed.");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function validateLocally(
  files: WorkspaceFile[],
  plan: WorkspaceBuildPlan,
  budgetMs: number,
  signal?: AbortSignal,
): Promise<SandboxValidation> {
  const policy = validateWorkspaceFiles(files);
  if (!policy.passed) throw new WorkspaceValidationError({
    code: "WORKSPACE_POLICY_FAILED",
    diagnostics: policy.issues,
    actionable: true,
    platformTransient: false,
  }, "Workspace source policy validation failed.");
  const root = await mkdtemp(join(tmpdir(), "findex-workspace-"));
  try {
    await materializeWorkspaceSource(root, files);
    for (const relativePath of localValidationFiles) {
      const destination = join(root, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await readFile(join(sandboxTemplateRoot, relativePath), "utf8"), "utf8");
    }
    await writeFile(join(root, "workspace-plan.json"), JSON.stringify(plan), "utf8");
    await symlink(join(process.cwd(), "node_modules"), join(root, "node_modules"), "dir");
    const environment = { ...process.env, WORKSPACE_PREVIEW_PORT: String(randomInt(42_000, 52_000)) };
    await runLocalScript({ root, script: "typecheck", timeoutMs: 45_000, budgetMs, environment, signal });
    await runLocalScript({ root, script: "bundle", timeoutMs: 60_000, budgetMs, environment, signal });
    await runLocalScript({ root, script: "test", timeoutMs: 90_000, budgetMs, environment, signal });
    const [desktop, mobile] = await Promise.all([
      readFile(join(root, "test-results", "workspace-desktop.png")),
      readFile(join(root, "test-results", "workspace-mobile.png")),
    ]);
    const bundle = await bundleWorkspaceResilient(files, root, signal);
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

/** Host IIFE bundle, falling back to the sandbox publish script when Workflow step resolution fails. */
export async function bundleWorkspaceResilient(files: WorkspaceFile[], existingRoot?: string, signal?: AbortSignal): Promise<WorkspaceBundle> {
  if (canResolveWorkspaceHostPackages()) {
    try {
      return await bundleWorkspace(files);
    } catch (error) {
      if (!isMissingHostBundlerPackages(error)) throw error;
    }
  }
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), "findex-workspace-publish-"));
  const ownsRoot = !existingRoot;
  try {
    if (ownsRoot) {
      await materializeWorkspaceSource(root, files);
      await writeFile(join(root, "package.json"), await readFile(join(sandboxTemplateRoot, "package.json"), "utf8"), "utf8");
      await symlink(join(process.cwd(), "node_modules"), join(root, "node_modules"), "dir");
    }
    await writeFile(join(root, "build-publish.mjs"), sandboxPublishBuildSource(), "utf8");
    await exec(process.execPath, [join(root, "build-publish.mjs")], {
      cwd: root,
      env: { ...process.env },
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
      signal,
    });
    const javascript = await readFile(join(root, "dist", "publish.js"), "utf8");
    const css = await readFile(join(root, "dist", "publish.css"), "utf8").catch(() => "");
    const metaRaw = await readFile(join(root, "dist", "publish.json"), "utf8").catch(() => "");
    const meta = metaRaw ? JSON.parse(metaRaw) as { bytes?: number; sha256?: string } : undefined;
    return workspaceBundleFromPublishArtifacts(javascript, css, meta);
  } finally {
    if (ownsRoot) await rm(root, { recursive: true, force: true });
  }
}

async function commandResult(sandbox: Sandbox, command: string, args: string[], timeoutMs: number, signal?: AbortSignal) {
  const result = await sandbox.runCommand(command, args, { timeoutMs, signal });
  const stdout = await result.stdout();
  const stderr = await result.stderr();
  if (result.exitCode !== 0) {
    const script = args.at(-1);
    const supportedScript = script === "typecheck" || script === "bundle" || script === "test" ? script : "test";
    throw new WorkspaceValidationError(commandValidationFailure({
      script: supportedScript,
      error: Object.assign(new Error(`${command} ${args.join(" ")} failed.`), { stdout, stderr }),
    }), `Workspace ${supportedScript} validation failed.`);
  }
  return stdout;
}

async function bundleWorkspaceInSandbox(sandbox: Sandbox, signal?: AbortSignal): Promise<WorkspaceBundle> {
  await sandbox.writeFiles([{ path: "publish-build.mjs", content: sandboxPublishBuildSource() }], { signal });
  await commandResult(sandbox, "node", ["publish-build.mjs"], 60_000, signal);
  const [javascriptBuffer, cssBuffer, metaBuffer] = await Promise.all([
    sandbox.fs.readFile("dist/publish.js", { signal }),
    sandbox.fs.readFile("dist/publish.css", { signal }).catch(() => Buffer.from("")),
    sandbox.fs.readFile("dist/publish.json", { signal }),
  ]);
  const meta = JSON.parse(metaBuffer.toString("utf8")) as { bytes?: number; sha256?: string };
  return workspaceBundleFromPublishArtifacts(
    javascriptBuffer.toString("utf8"),
    cssBuffer.toString("utf8"),
    meta,
  );
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
  if (!policy.passed) throw new WorkspaceValidationError({
    code: "WORKSPACE_POLICY_FAILED",
    diagnostics: policy.issues,
    actionable: true,
    platformTransient: false,
  }, "Workspace source policy validation failed.");
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId },
    timeout: Math.min(budgetMs, 250_000),
    networkPolicy: "deny-all",
    signal,
  });
  try {
    // Refresh host-owned harness files every run so snapshot drift cannot freeze
    // Chromium contract improvements behind an old VERCEL_SANDBOX_SNAPSHOT_ID.
    // Do not overwrite package.json — the snapshot's installed node_modules must stay authoritative.
    const harnessFiles = await Promise.all(
      vercelHarnessRefreshFiles.map(async (relativePath) => ({
        path: relativePath,
        content: await readFile(join(sandboxTemplateRoot, relativePath), "utf8"),
      })),
    );
    await sandbox.writeFiles([
      ...files.map((file) => ({ path: file.path, content: file.content })),
      ...harnessFiles,
      { path: "workspace-plan.json", content: JSON.stringify(plan) },
    ], { signal });
    await commandResult(sandbox, "npm", ["run", "typecheck"], 45_000, signal);
    await commandResult(sandbox, "npm", ["run", "bundle"], 60_000, signal);
    await commandResult(sandbox, "npm", ["run", "test"], 90_000, signal);
    const [desktop, mobile] = await Promise.all([
      sandbox.fs.readFile("test-results/workspace-desktop.png", { signal }),
      sandbox.fs.readFile("test-results/workspace-mobile.png", { signal }),
    ]);
    // The untrusted source was typechecked, tested, and preview-bundled in the
    // network-denied microVM. Publication also runs there so React/runtime packages
    // resolve from the snapshot toolchain instead of the serverless host layout.
    const bundle = await bundleWorkspaceInSandbox(sandbox, signal);
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
        { name: "Production bundle", passed: true, detail: `${bundle.bytes.toLocaleString()} byte sandbox publish bundle` },
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
  _complexity: BuildComplexityLevel,
  plan: WorkspaceBuildPlan,
  signal?: AbortSignal,
) {
  const mode = workspaceExecutionMode();
  if (mode === "disabled") throw new Error("Live workspace generation is disabled. No fallback workspace was substituted.");
  const budgetMs = 210_000;
  return mode === "vercel" ? validateInVercel(files, plan, budgetMs, signal) : validateLocally(files, plan, budgetMs, signal);
}

export async function quickCheckWorkspace(files: WorkspaceFile[]) {
  const policy = validateWorkspaceFiles(files);
  if (!policy.passed) return { passed: false, diagnostics: policy.issues };
  const hostBundlerReady = canResolveWorkspaceHostPackages();
  try {
    await strictTypecheckWorkspace(files, AbortSignal.timeout(45_000));
    if (!hostBundlerReady) {
      return {
        passed: true,
        diagnostics: ["Strict TypeScript passed; production bundle deferred to sandbox (host packages unavailable)."],
      };
    }
    const bundle = await bundleWorkspace(files);
    return { passed: true, diagnostics: [`Strict TypeScript and bundle checks passed (${bundle.bytes.toLocaleString()} bytes).`] };
  } catch (error) {
    const failure = error instanceof WorkspaceValidationError
      ? { code: error.code, diagnostics: error.diagnostics, platformTransient: error.platformTransient }
      : validationFailureFrom(error);
    // Serverless hosts may omit tsc or a filesystem-visible React tree. Defer those
    // platform gaps to the trusted sandbox validator — never real source diagnostics.
    if (failure.platformTransient || isHostToolchainGap(error)) {
      // Missing host React packages alone must not hide a real TypeScript failure.
      if (isMissingTypeScriptToolchain(error) && (isMissingHostBundlerPackages(error) || !canResolveWorkspaceHostPackages())) {
        return {
          passed: true,
          diagnostics: ["Policy passed; TypeScript/bundle preflight deferred to sandbox."],
        };
      }
      if (isMissingHostBundlerPackages(error) && !(error instanceof WorkspaceValidationError && error.code === "WORKSPACE_TYPECHECK_FAILED")) {
        return {
          passed: true,
          diagnostics: ["Strict TypeScript passed or deferred; production bundle deferred to sandbox."],
        };
      }
      try {
        const bundle = await bundleWorkspace(files);
        return {
          passed: true,
          diagnostics: [`Policy and bundle checks passed (${bundle.bytes.toLocaleString()} bytes); TypeScript deferred to sandbox.`],
        };
      } catch (bundleError) {
        if (isMissingHostBundlerPackages(bundleError)) {
          return {
            passed: true,
            diagnostics: ["Policy passed; TypeScript/bundle preflight deferred to sandbox."],
          };
        }
        if (bundleError instanceof WorkspaceValidationError) {
          return { passed: false, diagnostics: bundleError.diagnostics, code: bundleError.code };
        }
        return {
          passed: false,
          diagnostics: [bundleError instanceof Error ? bundleError.message : "Workspace bundle preflight failed."],
          code: "WORKSPACE_BUNDLE_FAILED",
        };
      }
    }
    if (isMissingHostBundlerPackages(error)) {
      return {
        passed: true,
        diagnostics: ["Strict TypeScript passed; production bundle deferred to sandbox."],
      };
    }
    if (error instanceof WorkspaceValidationError) return { passed: false, diagnostics: error.diagnostics, code: error.code };
    return { passed: false, diagnostics: [error instanceof Error ? error.message : "Workspace preflight failed."], code: "WORKSPACE_VALIDATION_FAILED" };
  }
}

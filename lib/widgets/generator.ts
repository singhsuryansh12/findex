import "server-only";

import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { Sandbox } from "e2b";
import {
  buildWidgetDataEnvelope,
  createFallbackArtifact,
  type WidgetArtifact,
  type WidgetSpec,
} from "./contracts";
import { resolveWidgetExecutor, type WidgetExecutor } from "./execution";
import { validateWidgetSource } from "./validator";

const exec = promisify(execFile);

type SandboxResult = {
  source: string;
  summary: { title: string; filesChanged: string[]; validationsRun: string[] };
  validation: { checks: Array<{ name: string; passed: boolean; detail: string }>; repairCount: number };
};

function widgetRequest(spec: WidgetSpec) {
  return {
    schemaVersion: 1,
    spec,
    data: buildWidgetDataEnvelope(spec),
    limits: {
      editableFiles: ["GeneratedWidget.tsx", "GeneratedWidget.test.tsx"],
      allowedImports: ["react", "recharts", "./widget-kit"],
      maximumSourceBytes: 25_000,
    },
  };
}

function parseRunnerOutput(stdout: string): SandboxResult {
  const parsed = JSON.parse(stdout.trim()) as SandboxResult;
  if (!parsed.source || !parsed.validation?.checks?.length) {
    throw new Error("Codex widget runner returned an incomplete artifact.");
  }
  return parsed;
}

async function runInE2b(
  spec: WidgetSpec,
  codexApiKey: string,
  signal?: AbortSignal,
): Promise<{ parsed: SandboxResult; sandbox: Sandbox }> {
  const sandbox = await Sandbox.create(process.env.E2B_TEMPLATE!, {
    apiKey: process.env.E2B_API_KEY,
    timeoutMs: 120_000,
    secure: true,
    envs: {
      CODEX_API_KEY: codexApiKey,
      CODEX_MODEL: process.env.CODEX_MODEL ?? "gpt-5.3-codex",
      CODEX_REASONING_EFFORT: process.env.CODEX_REASONING_EFFORT ?? "high",
    },
    signal,
  });

  try {
    const requestPath = "/home/user/findex-widget/widget-request.json";
    await sandbox.files.write(requestPath, JSON.stringify(widgetRequest(spec)));
    const result = await sandbox.commands.run(
      `node /opt/findex/runner.mjs ${requestPath}`,
      {
        cwd: "/home/user/findex-widget",
        timeoutMs: 90_000,
        signal,
        envs: {
          CODEX_API_KEY: codexApiKey,
          CODEX_MODEL: process.env.CODEX_MODEL ?? "gpt-5.3-codex",
          CODEX_REASONING_EFFORT: process.env.CODEX_REASONING_EFFORT ?? "high",
          FINDEX_WIDGET_EXECUTOR: "e2b",
          FINDEX_WIDGET_WORKSPACE: "/home/user/findex-widget",
          HOME: "/home/user",
          PATH: "/usr/local/bin:/usr/bin:/bin",
          NODE_ENV: "production",
        },
      },
    );
    return { parsed: parseRunnerOutput(result.stdout), sandbox };
  } catch (error) {
    await sandbox.kill({ signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    throw error;
  }
}

async function initializeLocalWorkspace(root: string) {
  const workspace = join(root, "workspace");
  await cp(join(process.cwd(), "e2b", "scaffold"), workspace, {
    recursive: true,
    filter: (source) => basename(source) !== "node_modules",
  });
  await symlink(join(process.cwd(), "node_modules"), join(workspace, "node_modules"), "dir");
  await exec("git", ["init"], { cwd: workspace });
  await exec("git", ["config", "user.email", "demo@findex.local"], { cwd: workspace });
  await exec("git", ["config", "user.name", "FinDex"], { cwd: workspace });
  await exec("git", ["add", "."], { cwd: workspace });
  await exec("git", ["commit", "-m", "scaffold"], { cwd: workspace });
  return workspace;
}

async function runLocally(spec: WidgetSpec, codexApiKey: string | undefined, signal?: AbortSignal) {
  const root = await mkdtemp(join(tmpdir(), "findex-widget-"));
  try {
    const workspace = await initializeLocalWorkspace(root);
    const requestPath = join(workspace, "widget-request.json");
    await writeFile(requestPath, JSON.stringify(widgetRequest(spec)), "utf8");
    const env: NodeJS.ProcessEnv = {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      CODEX_HOME: process.env.CODEX_HOME,
      CODEX_MODEL: process.env.LOCAL_CODEX_MODEL ?? "gpt-5.6-terra",
      CODEX_REASONING_EFFORT: process.env.LOCAL_CODEX_REASONING_EFFORT ?? "medium",
      FINDEX_WIDGET_EXECUTOR: "local",
      FINDEX_WIDGET_WORKSPACE: workspace,
      NODE_ENV: "production",
    };
    if (codexApiKey) env.CODEX_API_KEY = codexApiKey;
    const result = await exec(process.execPath, [join(process.cwd(), "e2b", "runner.mjs"), requestPath], {
      cwd: workspace,
      env,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 90_000,
      signal,
    });
    return parseRunnerOutput(result.stdout);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function generateWidget(spec: WidgetSpec, signal?: AbortSignal): Promise<WidgetArtifact> {
  const fallback = createFallbackArtifact(spec);
  const codexApiKey = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
  const executor = resolveWidgetExecutor({
    requested: process.env.WIDGET_EXECUTION_MODE,
    enabled: process.env.ENABLE_LIVE_WIDGETS !== "false",
    nodeEnv: process.env.NODE_ENV,
    hasE2bConfig: Boolean(process.env.E2B_API_KEY && process.env.E2B_TEMPLATE),
    hasCodexCredential: Boolean(codexApiKey),
  });
  if (executor === "disabled") return fallback;

  const startedAt = Date.now();
  let sandbox: Sandbox | undefined;
  try {
    let parsed: SandboxResult;
    if (executor === "e2b") {
      const result = await runInE2b(spec, codexApiKey!, signal);
      sandbox = result.sandbox;
      parsed = result.parsed;
    } else {
      parsed = await runLocally(spec, codexApiKey, signal);
    }
    const policy = validateWidgetSource(parsed.source);
    if (!policy.passed || !parsed.validation.checks.every((check) => check.passed)) {
      throw new Error([...policy.issues, ...parsed.validation.checks.filter((check) => !check.passed).map((check) => check.detail)].join(" "));
    }

    return {
      schemaVersion: 1,
      id: `live-${spec.kind}-${Date.now()}`,
      title: spec.title,
      kind: spec.kind,
      source: parsed.source,
      props: buildWidgetDataEnvelope(spec),
      mode: "live",
      model: executor === "e2b"
        ? process.env.CODEX_MODEL ?? "gpt-5.3-codex"
        : process.env.LOCAL_CODEX_MODEL ?? "gpt-5.6-terra",
      validation: {
        passed: true,
        checks: [...parsed.validation.checks, ...policy.checks.filter((check) => check.name === "Policy scan")],
        issues: [],
      },
      durationMs: Date.now() - startedAt,
      repairCount: parsed.validation.repairCount,
      generatedAt: new Date().toISOString(),
      provenance: executor === "e2b"
        ? "Codex CLI in disposable E2B · filtered mock data · sandbox validated"
        : "Local Codex CLI · filtered mock data · sandbox validated",
    };
  } catch (error) {
    console.warn("Live widget generation failed; returning verified sample.", {
      message: error instanceof Error ? error.message : "Unknown widget generation error",
    });
    return { ...fallback, durationMs: Date.now() - startedAt };
  } finally {
    if (sandbox) {
      try {
        await sandbox.kill({ signal: AbortSignal.timeout(10_000) });
      } catch {
        console.error("E2B sandbox cleanup failed; verify the E2B lifecycle dashboard.");
      }
    }
  }
}

export type { WidgetExecutor };

import "server-only";

import { Sandbox } from "e2b";
import {
  buildWidgetDataEnvelope,
  createFallbackArtifact,
  type WidgetArtifact,
  type WidgetSpec,
} from "./contracts";
import { validateWidgetSource } from "./validator";

type SandboxResult = {
  source: string;
  summary: { title: string; filesChanged: string[]; validationsRun: string[] };
  validation: { checks: Array<{ name: string; passed: boolean; detail: string }>; repairCount: number };
};

export async function generateWidget(spec: WidgetSpec, signal?: AbortSignal): Promise<WidgetArtifact> {
  const fallback = createFallbackArtifact(spec);
  if (
    process.env.ENABLE_LIVE_WIDGETS === "false" ||
    !process.env.OPENAI_API_KEY ||
    !process.env.E2B_API_KEY ||
    !process.env.E2B_TEMPLATE
  ) {
    return fallback;
  }

  const startedAt = Date.now();
  let sandbox: Sandbox | undefined;
  try {
    sandbox = await Sandbox.create(process.env.E2B_TEMPLATE, {
      apiKey: process.env.E2B_API_KEY,
      timeoutMs: 120_000,
      secure: true,
      envs: {
        CODEX_API_KEY: process.env.OPENAI_API_KEY,
        CODEX_MODEL: process.env.CODEX_MODEL ?? "gpt-5.3-codex",
      },
      signal,
    });

    const request = {
      schemaVersion: 1,
      spec,
      data: buildWidgetDataEnvelope(spec),
      limits: {
        editableFiles: ["GeneratedWidget.tsx", "GeneratedWidget.test.tsx"],
        allowedImports: ["react", "recharts", "./widget-kit"],
        maximumSourceBytes: 25_000,
      },
    };
    await sandbox.files.write("/tmp/findex-widget-request.json", JSON.stringify(request));

    const result = await sandbox.commands.run(
      "node /opt/findex/runner.mjs /tmp/findex-widget-request.json",
      {
        cwd: "/home/user/findex-widget",
        timeoutMs: 90_000,
        signal,
        envs: {
          CODEX_API_KEY: process.env.OPENAI_API_KEY,
          CODEX_MODEL: process.env.CODEX_MODEL ?? "gpt-5.3-codex",
          HOME: "/home/user",
          PATH: "/usr/local/bin:/usr/bin:/bin",
          NODE_ENV: "production",
        },
      },
    );
    const parsed = JSON.parse(result.stdout.trim()) as SandboxResult;
    const policy = validateWidgetSource(parsed.source);
    if (!policy.passed || !parsed.validation.checks.every((check) => check.passed)) {
      throw new Error([...policy.issues, ...parsed.validation.checks.filter((check) => !check.passed).map((check) => check.detail)].join(" "));
    }

    return {
      schemaVersion: 1,
      id: `live-${spec.kind}-${Date.now()}`,
      title: parsed.summary.title || spec.title,
      kind: spec.kind,
      source: parsed.source,
      props: buildWidgetDataEnvelope(spec),
      mode: "live",
      model: process.env.CODEX_MODEL ?? "gpt-5.3-codex",
      validation: {
        passed: true,
        checks: [...parsed.validation.checks, ...policy.checks.filter((check) => check.name === "Policy scan")],
        issues: [],
      },
      durationMs: Date.now() - startedAt,
      repairCount: parsed.validation.repairCount,
      generatedAt: new Date().toISOString(),
      provenance: "Aggregated mock balances and purpose-filtered transactions · validated in disposable E2B",
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

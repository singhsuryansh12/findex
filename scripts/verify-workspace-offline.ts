/**
 * Credential-free workspace pipeline checks. No OpenAI calls.
 * Covers contract lint, host bundler, and sandbox publish bundler.
 * Host TypeScript preflight is covered by tests/integration/workspace-preflight.test.ts.
 */
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  bundleWorkspace,
  canResolveWorkspaceHostPackages,
  sandboxPublishBuildSource,
  workspaceBundleFromPublishArtifacts,
} from "../lib/workspaces/bundle";
import { lintWorkspacePlanContract } from "../lib/workspaces/contract-lint";
import type { WorkspaceBuildPlan } from "../lib/workspaces/contracts";

const exec = promisify(execFile);

const goodSource = `import React from "react";
import { useWorkspaceState } from "@findex/workspace-sdk";
import "./styles.css";
export default function App() {
  const [scenario, setScenario] = useWorkspaceState<{ annualSpend: number }>("fire-planner", { annualSpend: 60000 });
  return (
    <main className="workspace">
      <h1>FIRE planner</h1>
      <label htmlFor="annual-spend">Annual spending (USD)
        <input id="annual-spend" type="number" required min={1000} max={500000} step={1000} value={scenario.annualSpend}
          onChange={(event) => setScenario({ annualSpend: Number(event.target.value) })} />
      </label>
      <p aria-label="FIRE target">FIRE target: {scenario.annualSpend * 25}</p>
      <p aria-live="polite" role="status">Updated</p>
      <p>Educational information only; not financial advice.</p>
    </main>
  );
}`;

const styles = { path: "src/styles.css", content: "main{max-width:50rem;margin:auto;padding:1rem}" };

const plan: WorkspaceBuildPlan = {
  schemaVersion: 2,
  intent: "create",
  title: "FIRE planner",
  goal: "Plan financial independence",
  response: "",
  assumptions: ["4% withdrawal rate", "Real-return model with today-dollar contributions and target"],
  inputs: [{
    id: "annualSpend",
    label: "Annual spending",
    type: "currency",
    description: "Annual retirement spending",
    required: true,
    defaultValue: "60000",
    min: "1000",
    max: "500000",
    step: "1000",
  }],
  outputs: [{ id: "target", label: "FIRE target", description: "Nest egg target", format: "USD" }],
  interactions: ["Annual spending updates the FIRE target"],
  layout: ["Responsive calculator"],
  dataNeeds: [],
  persistence: { enabled: true, stateSchemaVersion: 1, description: "Save the scenario" },
  capabilities: ["workspace.state"],
  disclosures: ["Educational information only; not financial advice."],
  acceptanceCriteria: ["Changing annual spending updates the FIRE target"],
  clarificationQuestions: [],
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const tscPath = join(process.cwd(), "node_modules", "typescript", "lib", "tsc.js");
  assert(existsSync(tscPath), `Expected runnable tsc at ${tscPath}`);
  assert(!tscPath.includes("[externals]"), "tsc path must not be a Next.js [externals] stub");
  assert(canResolveWorkspaceHostPackages(), "Host React/runtime packages must resolve for local bundling.");

  const files = [{ path: "src/App.tsx", content: goodSource }, styles];
  const contract = lintWorkspacePlanContract(plan, files);
  assert(contract.passed, `Contract lint failed: ${contract.diagnostics.join("; ")}`);
  console.log(JSON.stringify({ event: "offline_verify", step: "contractLint", ok: true }));

  const preflightRoot = await mkdtemp(join(tmpdir(), "findex-offline-preflight-"));
  try {
    await mkdir(join(preflightRoot, "src"), { recursive: true });
    await writeFile(join(preflightRoot, "src/App.tsx"), goodSource, "utf8");
    await writeFile(join(preflightRoot, "src/styles.css"), styles.content, "utf8");
    await writeFile(
      join(preflightRoot, "src/workspace-sdk.d.ts"),
      await readFile(join(process.cwd(), "infrastructure/workspace-sandbox/src/workspace-sdk.d.ts"), "utf8"),
      "utf8",
    );
    await writeFile(
      join(preflightRoot, "tsconfig.json"),
      await readFile(join(process.cwd(), "infrastructure/workspace-sandbox/tsconfig.preflight.json"), "utf8"),
      "utf8",
    );
    await symlink(join(process.cwd(), "node_modules"), join(preflightRoot, "node_modules"), "dir");
    await exec(process.execPath, [tscPath, "--noEmit", "-p", preflightRoot], { cwd: preflightRoot });
    console.log(JSON.stringify({ event: "offline_verify", step: "preflightTypecheck", ok: true }));
  } finally {
    await rm(preflightRoot, { recursive: true, force: true });
  }

  const hostBundle = await bundleWorkspace(files);
  assert(hostBundle.javascript.length > 500, "Host bundle produced no JavaScript.");
  console.log(JSON.stringify({ event: "offline_verify", step: "hostBundle", ok: true, bytes: hostBundle.bytes }));

  const root = await mkdtemp(join(tmpdir(), "findex-offline-publish-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/App.tsx"), goodSource, "utf8");
    await writeFile(join(root, "src/styles.css"), styles.content, "utf8");
    await writeFile(join(root, "publish-build.mjs"), sandboxPublishBuildSource(), "utf8");
    await symlink(join(process.cwd(), "node_modules"), join(root, "node_modules"), "dir");
    await exec(process.execPath, ["publish-build.mjs"], { cwd: root });
    const javascript = await readFile(join(root, "dist/publish.js"), "utf8");
    const css = await readFile(join(root, "dist/publish.css"), "utf8");
    const meta = JSON.parse(await readFile(join(root, "dist/publish.json"), "utf8")) as { bytes?: number; sha256?: string };
    const published = workspaceBundleFromPublishArtifacts(javascript, css, meta);
    assert(published.javascript.length > 10_000, "Publish bundle looks too small.");
    console.log(JSON.stringify({ event: "offline_verify", step: "sandboxPublish", ok: true, bytes: published.bytes }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ event: "offline_verify", state: "passed" }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "offline_verify",
    state: "failed",
    message: error instanceof Error ? error.message : "Unknown failure",
  }));
  process.exitCode = 1;
});

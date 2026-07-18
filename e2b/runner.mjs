import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Codex } from "@openai/codex-sdk";

const exec = promisify(execFile);
const workspace = "/home/user/findex-widget";
const requestPath = process.argv[2];
if (!requestPath) throw new Error("A widget request path is required.");

const request = JSON.parse(await readFile(requestPath, "utf8"));
const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "filesChanged", "validationsRun"],
  properties: {
    title: { type: "string" },
    filesChanged: { type: "array", items: { type: "string" } },
    validationsRun: { type: "array", items: { type: "string" } },
  },
};
const prompt = `Build the React widget described in the sanitized request at ${requestPath}.
Read that JSON first. Edit only GeneratedWidget.tsx and, if necessary, GeneratedWidget.test.tsx.
The default export must accept { data } and use the supplied integer-cent values. It may import only React, Recharts, and ./widget-kit.
Make every requested control interactive and accessible. Do not use networking, storage, dynamic imports, unsafe HTML, globals from a parent window, or arbitrary execution APIs.
Keep GeneratedWidget.tsx under 25 KB. Run npm run typecheck, npm run lint, npm run test, and npm run bundle before finishing.`;

const codex = new Codex({
  apiKey: process.env.CODEX_API_KEY,
  env: {
    OPENAI_API_KEY: process.env.CODEX_API_KEY ?? "",
    HOME: "/home/user",
    PATH: "/usr/local/bin:/usr/bin:/bin",
  },
});
const thread = codex.startThread({
  model: process.env.CODEX_MODEL ?? "gpt-5.3-codex",
  sandboxMode: "workspace-write",
  workingDirectory: workspace,
  approvalPolicy: "never",
  networkAccessEnabled: false,
  webSearchMode: "disabled",
});

let repairCount = 0;
let turn = await thread.run(prompt, { outputSchema });

async function validations() {
  const changed = (await exec("git", ["diff", "--name-only"], { cwd: workspace })).stdout.trim().split("\n").filter(Boolean);
  const unexpected = changed.filter((file) => !["GeneratedWidget.tsx", "GeneratedWidget.test.tsx"].includes(file));
  if (unexpected.length) throw new Error(`Unexpected files changed: ${unexpected.join(", ")}`);
  const commands = ["typecheck", "lint", "test", "bundle"];
  const checks = [];
  for (const name of commands) {
    try {
      await exec("npm", ["run", name], { cwd: workspace, timeout: 25_000 });
      checks.push({ name, passed: true, detail: `${name} passed` });
    } catch (error) {
      const detail = `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim().slice(-3000);
      checks.push({ name, passed: false, detail });
    }
  }
  const source = await readFile(`${workspace}/GeneratedWidget.tsx`, "utf8");
  if (Buffer.byteLength(source) > 25_000) checks.push({ name: "source-size", passed: false, detail: "GeneratedWidget.tsx exceeds 25 KB" });
  return { checks, source };
}

let report = await validations();
if (report.checks.some((check) => !check.passed)) {
  repairCount = 1;
  const diagnostics = report.checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.detail}`).join("\n");
  turn = await thread.run(`Repair the widget using these validation diagnostics, then rerun every validation:\n${diagnostics}`, { outputSchema });
  report = await validations();
}

let summary;
try { summary = JSON.parse(turn.finalResponse); } catch { summary = { title: request.spec.title, filesChanged: ["GeneratedWidget.tsx"], validationsRun: ["typecheck", "lint", "test", "bundle"] }; }
process.stdout.write(JSON.stringify({ source: report.source, summary, validation: { checks: report.checks, repairCount } }));

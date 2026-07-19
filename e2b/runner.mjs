import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Codex } from "@openai/codex-sdk";

const exec = promisify(execFile);
const workspace = process.env.FINDEX_WIDGET_WORKSPACE ?? "/home/user/findex-widget";
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
The scaffold already contains a strict, interactive, tested FIRE calculator baseline. Preserve its working structure and make only the changes required by the sanitized spec; do not rewrite working boilerplate without a concrete reason.
The default export must accept { data } and use the supplied integer-cent values. It may import only React, Recharts, and ./widget-kit.
This project uses strict TypeScript with noImplicitAny. Define the widget data/props types and explicitly type every helper parameter, callback parameter, and destructured prop.
Make every requested control interactive and accessible. Do not use networking, storage, dynamic imports, unsafe HTML, globals from a parent window, or arbitrary execution APIs.
Keep GeneratedWidget.tsx under 25 KB. Do not run shell commands or validation tasks during this turn; the trusted host validator runs typecheck, lint, tests, and the production bundle immediately after you finish editing.`;

const codexEnvironment = {
  HOME: process.env.HOME ?? "/home/user",
  PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
};
if (process.env.CODEX_HOME) codexEnvironment.CODEX_HOME = process.env.CODEX_HOME;
const codexOptions = { env: codexEnvironment };
if (process.env.CODEX_API_KEY) codexOptions.apiKey = process.env.CODEX_API_KEY;
const codex = new Codex(codexOptions);
const threadOptions = {
  sandboxMode: "workspace-write",
  workingDirectory: workspace,
  approvalPolicy: "never",
  networkAccessEnabled: false,
  webSearchMode: "disabled",
  modelReasoningEffort: process.env.CODEX_REASONING_EFFORT ?? "medium",
};
if (process.env.CODEX_MODEL) threadOptions.model = process.env.CODEX_MODEL;
const thread = codex.startThread(threadOptions);

let repairCount = 0;
let turn = await thread.run(prompt, { outputSchema });

async function validations() {
  const status = (await exec("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: workspace })).stdout;
  const changed = status.split("\n").filter((line) => line.length >= 4).map((line) => {
    const path = line.slice(3);
    return path.includes(" -> ") ? path.split(" -> ").at(-1) : path;
  });
  const unexpected = changed.filter((file) => !["GeneratedWidget.tsx", "GeneratedWidget.test.tsx", "widget-request.json"].includes(file));
  if (unexpected.length) throw new Error(`Unexpected files changed: ${unexpected.join(", ")}`);
  const commands = ["typecheck", "lint", "test", "bundle"];
  const checks = [];
  for (const name of commands) {
    try {
      await exec("npm", ["run", name], {
        cwd: workspace,
        timeout: 25_000,
        env: {
          HOME: process.env.HOME ?? "/home/user",
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          CI: "1",
          NODE_ENV: name === "bundle" ? "production" : "test",
        },
      });
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
  turn = await thread.run(`Repair only the widget files using these validation diagnostics. Do not run commands; the trusted host will rerun every validation after your edit:\n${diagnostics}`, { outputSchema });
  report = await validations();
}

let summary;
try { summary = JSON.parse(turn.finalResponse); } catch { summary = { title: request.spec.title, filesChanged: ["GeneratedWidget.tsx"], validationsRun: ["typecheck", "lint", "test", "bundle"] }; }
process.stdout.write(JSON.stringify({ source: report.source, summary, validation: { checks: report.checks, repairCount } }));

import { Template, defaultBuildLogger } from "e2b";

const name = process.env.E2B_TEMPLATE ?? "findex-codex-widget:v2";
const template = Template({ fileContextPath: process.cwd() })
  .fromTemplate("openai-codex")
  .makeDir(["/home/user/findex-widget", "/opt/findex"])
  .copy("e2b/scaffold", "/home/user/findex-widget")
  .copy("e2b/runner.mjs", "/opt/findex/runner.mjs", { mode: 0o755 })
  .runCmd("cd /home/user/findex-widget && npm install --ignore-scripts", { user: "user" })
  .runCmd("cd /home/user/findex-widget && git init && git config user.email demo@findex.local && git config user.name FinDex && git add . && git commit -m scaffold", { user: "user" });

const result = await Template.build(template, name, {
  onBuildLogs: defaultBuildLogger(),
});
console.log(`Built E2B template ${name}: ${result.templateId}`);

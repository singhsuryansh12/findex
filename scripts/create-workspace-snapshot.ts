import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Sandbox } from "@vercel/sandbox";

const templateRoot = join(process.cwd(), "infrastructure", "workspace-sandbox");

const relativeFiles = [
  "package.json",
  "tsconfig.json",
  "build.mjs",
  "preview.tsx",
  "server.mjs",
  "playwright.config.ts",
  "vitest.config.ts",
  "workspace.e2e.ts",
  "workspace-plan.json",
  "src/App.tsx",
  "src/styles.css",
  "src/workspace-sdk.d.ts",
  "src/workspace.test.ts",
];

const sandbox = await Sandbox.create({
  runtime: "node22",
  timeout: 10 * 60_000,
  networkPolicy: { allow: ["registry.npmjs.org", "cdn.playwright.dev", "playwright.azureedge.net"] },
});

try {
  await sandbox.writeFiles(await Promise.all(relativeFiles.map(async (path) => ({
    path,
    content: await readFile(join(templateRoot, path), "utf8"),
  }))));
  const install = await sandbox.runCommand("npm", ["install", "--no-audit", "--no-fund"], { timeoutMs: 5 * 60_000 });
  if (install.exitCode !== 0) throw new Error(`${await install.stdout()}\n${await install.stderr()}`);
  const chromium = await sandbox.runCommand("npx", ["playwright", "install", "chromium"], { timeoutMs: 5 * 60_000 });
  if (chromium.exitCode !== 0) throw new Error(`${await chromium.stdout()}\n${await chromium.stderr()}`);
  await sandbox.update({ networkPolicy: "deny-all" });
  const typecheck = await sandbox.runCommand("npm", ["run", "typecheck"], { timeoutMs: 60_000 });
  if (typecheck.exitCode !== 0) throw new Error(`${await typecheck.stdout()}\n${await typecheck.stderr()}`);
  const bundle = await sandbox.runCommand("npm", ["run", "bundle"], { timeoutMs: 60_000 });
  if (bundle.exitCode !== 0) throw new Error(`${await bundle.stdout()}\n${await bundle.stderr()}`);
  const test = await sandbox.runCommand("npm", ["run", "test"], { timeoutMs: 90_000 });
  if (test.exitCode !== 0) throw new Error(`${await test.stdout()}\n${await test.stderr()}`);
  const snapshot = await sandbox.snapshot({ expiration: 0 });
  await sandbox.stop().catch(() => undefined);
  console.log(`VERCEL_SANDBOX_SNAPSHOT_ID=${snapshot.snapshotId}`);
} catch (error) {
  await sandbox.stop().catch(() => undefined);
  throw error;
}

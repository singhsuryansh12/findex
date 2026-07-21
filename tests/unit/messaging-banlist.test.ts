import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const SCOPED_PATHS = [
  "components/dashboard",
  "components/brain",
  "components/workspaces",
  "app/layout.tsx",
  "lib/brain/guidance.ts",
];

const FORBIDDEN = [
  "Money, anticipated",
  "Login as Demo User",
  "financial operating system",
  "Your financial operating system",
  "built live by Codex",
  "Adaptive workspace library",
  "Generated workspace",
];

function collectFiles(entry: string): string[] {
  const absolute = join(ROOT, entry);
  const stats = statSync(absolute);
  if (stats.isFile()) {
    return absolute.endsWith(".ts") || absolute.endsWith(".tsx") ? [absolute] : [];
  }

  const files: string[] = [];
  for (const child of readdirSync(absolute)) {
    if (child === "node_modules" || child.startsWith(".")) continue;
    files.push(...collectFiles(join(entry, child)));
  }
  return files;
}

describe("messaging ban-list", () => {
  it("keeps forbidden brand phrases out of scoped UI source", () => {
    const files = SCOPED_PATHS.flatMap(collectFiles);
    expect(files.length).toBeGreaterThan(10);

    const hits: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const phrase of FORBIDDEN) {
        if (source.includes(phrase)) {
          hits.push(`${relative(ROOT, file)}: ${phrase}`);
        }
      }
    }

    expect(hits).toEqual([]);
  });
});

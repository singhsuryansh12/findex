import { describe, expect, it } from "vitest";
import {
  bundleWorkspace,
  canResolveWorkspaceHostPackages,
  isMissingHostBundlerPackages,
  sandboxPublishBuildSource,
} from "@/lib/workspaces/bundle";

describe("workspace host bundler", () => {
  it("bundles a React workspace without relying on PATH-visible module lookup", async () => {
    expect(canResolveWorkspaceHostPackages()).toBe(true);
    const result = await bundleWorkspace([
      {
        path: "src/App.tsx",
        content: `import React, { useState } from "react";
import "./styles.css";
export default function App() {
  const [value, setValue] = useState(1);
  return <main><button type="button" onClick={() => setValue(value + 1)}>{value}</button></main>;
}`,
      },
      { path: "src/styles.css", content: "main{padding:1rem}" },
    ]);
    expect(result.javascript.length).toBeGreaterThan(500);
    expect(result.css).toContain("padding");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("exposes a sandbox publish script with the trusted bridge runtime", () => {
    const source = sandboxPublishBuildSource();
    expect(source).toContain("__findexConnect");
    expect(source).toContain("findex:init");
    expect(source).toContain("dist/publish.js");
    expect(isMissingHostBundlerPackages(new Error('Could not resolve "react/jsx-runtime"'))).toBe(true);
  });
});

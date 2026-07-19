import { describe, expect, it } from "vitest";
import type { WorkspaceBuildPlan, WorkspaceFile } from "@/lib/workspaces/contracts";
import { validateAndBundleWorkspace } from "@/lib/workspaces/sandbox";

const enabled = process.env.RUN_LOCAL_SANDBOX_EVAL === "1";

describe.skipIf(!enabled)("local workspace sandbox parity", () => {
  it("runs typecheck, unit policy, bundle, Chromium interaction, and screenshots", async () => {
    const files: WorkspaceFile[] = [{
      path: "src/App.tsx",
      content: `import React,{useState} from "react";import "./styles.css";export default function App(){const [amount,setAmount]=useState(10);return <main><h1>Interactive verification lab</h1><label>Amount<input type="number" value={amount} onChange={(event)=>setAmount(Number(event.target.value))}/></label><span>Result</span><output>{amount*2}</output></main>}`,
    }, { path: "src/styles.css", content: "main{max-width:720px;margin:auto;padding:24px}input{width:100%}" }];
    const plan: WorkspaceBuildPlan = {
      schemaVersion: 2, intent: "create", title: "Interactive verification lab", goal: "Verify local parity", response: "",
      assumptions: [], inputs: [{ id: "amount", label: "Amount", type: "number", description: "Test amount", required: true, defaultValue: "10" }],
      outputs: [{ id: "result", label: "Result", description: "Double the amount", format: "number" }],
      interactions: ["Changing Amount updates Result"], layout: ["Responsive single view"], dataNeeds: [],
      persistence: { enabled: false, stateSchemaVersion: 1, description: "" }, capabilities: [],
      disclosures: ["Educational only"], acceptanceCriteria: ["Amount changes the rendered result"], clarificationQuestions: [],
    };
    const result = await validateAndBundleWorkspace(files, "simple", plan);
    expect(result.executor).toBe("local");
    expect(result.screenshots?.desktop.length).toBeGreaterThan(100);
    expect(result.screenshots?.mobile.length).toBeGreaterThan(100);
    expect(result.checks.find((check) => check.name === "Chromium interaction")?.passed).toBe(true);
  }, 120_000);
});

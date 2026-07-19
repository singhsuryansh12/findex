import { describe, expect, it } from "vitest";
import { bundleWorkspace } from "@/lib/workspaces/bundle";
import { complexityPolicy, enforceComplexityFloor, nextEffort, normalizePlanForActiveWorkspace } from "@/lib/workspaces/complexity";
import type { ActiveWorkspaceContext, WorkspaceBuildPlan, WorkspaceFile } from "@/lib/workspaces/contracts";
import { validateWorkspaceFiles } from "@/lib/workspaces/policy";
import { parseCapabilityInput } from "@/lib/workspaces/capability-inputs";
import { signArtifactSignature, signCapabilityToken, signClarificationToken, verifyArtifactSignature, verifyCapabilityToken, verifyClarificationToken } from "@/lib/workspaces/signing";

const files: WorkspaceFile[] = [
  {
    path: "src/App.tsx",
    content: `import React, { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer } from "recharts";
import { useWorkspaceState } from "@findex/workspace-sdk";
import "./styles.css";
export default function App(){
  const [amount,setAmount] = useState(50000);
  const [saved,setSaved] = useWorkspaceState("scenario", { rate: 7 });
  const rows = useMemo(() => [{name:"Cash",value:amount},{name:"Loan",value:amount*(1+saved.rate/100)}],[amount,saved.rate]);
  return <main className="workspace"><h1>Cash versus financing lab</h1><label>Purchase amount<input aria-label="Purchase amount" type="number" value={amount} onChange={(event)=>setAmount(Number(event.target.value))}/></label><button onClick={()=>setSaved({rate:saved.rate+1})}>Raise rate</button><ResponsiveContainer width="100%" height={220}><BarChart data={rows}><Bar dataKey="value" /></BarChart></ResponsiveContainer><p>Educational, not financial advice.</p></main>;
}`,
  },
  { path: "src/styles.css", content: `.workspace{padding:24px} input{display:block}` },
];

function plan(capabilities: WorkspaceBuildPlan["capabilities"], persistent = false): WorkspaceBuildPlan {
  return {
    schemaVersion: 2,
    intent: "create",
    title: "Flexible finance lab",
    goal: "Compare scenarios",
    response: "",
    assumptions: [],
    inputs: [],
    outputs: [],
    interactions: [],
    layout: ["single responsive view"],
    dataNeeds: [],
    persistence: { enabled: persistent, stateSchemaVersion: 1, description: "" },
    capabilities,
    disclosures: ["Educational only"],
    acceptanceCriteria: ["The workspace is interactive"],
    clarificationQuestions: [],
  };
}

describe("adaptive reasoning policy", () => {
  it("maps simple, standard, and complex builds to calibrated effort and budgets", () => {
    expect(complexityPolicy.simple).toMatchObject({ effort: "low", budgetMs: 90_000 });
    expect(complexityPolicy.standard).toMatchObject({ effort: "medium", budgetMs: 160_000 });
    expect(complexityPolicy.complex).toMatchObject({ effort: "high", budgetMs: 240_000 });
    expect(nextEffort("low")).toBe("medium");
    expect(nextEffort("medium")).toBe("high");
  });

  it("enforces host complexity floors from capabilities instead of prompt-controlled effort", () => {
    const base = { level: "simple" as const, riskFlags: [], rationale: "One screen" };
    expect(enforceComplexityFloor(base, plan(["ledger.snapshot"])).level).toBe("standard");
    expect(enforceComplexityFloor(base, plan(["market.quote"]))).toMatchObject({ level: "complex", riskFlags: ["live_data"] });
    expect(enforceComplexityFloor(base, plan(["workspace.state"], true)).level).toBe("complex");
    expect(enforceComplexityFloor(base, { ...plan([]), goal: "Model capital gains tax scenarios" }).level).toBe("complex");
  });

  it("forces active prompts to revise in place and preserves the persisted state schema", () => {
    const requested = { ...plan([], true), intent: "create" as const, interactions: ["Export data as CSV"] };
    requested.persistence.stateSchemaVersion = 9;
    const normalized = normalizePlanForActiveWorkspace(requested, {
      manifest: { stateSchemaVersion: 3 } as ActiveWorkspaceContext["manifest"],
    });
    expect(normalized.intent).toBe("revise");
    expect(normalized.persistence.stateSchemaVersion).toBe(3);
    expect(normalized.capabilities).toEqual(["workspace.state", "file.export"]);
    expect(normalized.assumptions.at(-1)).toContain("schema version 3");
  });
});

describe("general workspace source boundary", () => {
  it("accepts and precompiles a multi-file workspace without a widget kind", async () => {
    expect(validateWorkspaceFiles(files)).toMatchObject({ passed: true, issues: [] });
    const bundle = await bundleWorkspace(files);
    expect(bundle.javascript.length).toBeGreaterThan(1_000);
    expect(bundle.bytes).toBeLessThan(2_000_000);
    expect(bundle.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["network API", `export default function App(){fetch("https://bad.test");return <div/>}`],
    ["browser storage", `export default function App(){localStorage.setItem("x","y");return <div/>}`],
    ["invalid import", `import x from "left-pad";export default function App(){return <div>{x}</div>}`],
    ["dynamic import", `export default async function App(){await import("react");return <div/>}`],
    ["iframe", `export default function App(){return <iframe src="https://bad.test"/>}`],
    ["parent access", `export default function App(){window.parent.postMessage("x","*");return <div/>}`],
    ["unsafe HTML", `export default function App(){return <div dangerouslySetInnerHTML={{__html:"x"}}/>}`],
    ["infinite loop", `export default function App(){while(true){}return <div/>}`],
    ["timer loop", `export default function App(){setInterval(()=>{},1);return <div/>}`],
    ["delayed loop", `export default function App(){setTimeout(()=>{},1);return <div/>}`],
    ["bounded-looking loop", `export default function App(){for(let i=0;i<3;i++){}return <div/>}`],
    ["direct parent access", `export default function App(){parent.postMessage("x","*");return <div/>}`],
    ["external image", `export default function App(){return <img src="https://bad.test/pixel"/>}`],
    ["embedded secret", `export default function App(){const key="sk-proj-abcdefghijklmnop";return <div>{key}</div>}`],
    ["file input", `export default function App(){return <input type="file"/>}`],
    ["self navigation", `export default function App(){return <a href="https://bad.test">Leave</a>}`],
  ])("rejects %s", (_label, content) => {
    expect(validateWorkspaceFiles([{ path: "src/App.tsx", content }]).passed).toBe(false);
  });

  it("rejects source path traversal and oversized source", () => {
    expect(validateWorkspaceFiles([{ path: "src/../secret.ts", content: "export default 1" }]).passed).toBe(false);
    expect(validateWorkspaceFiles([{ path: "src/App.tsx", content: `export default function App(){return <div>${"x".repeat(256_000)}</div>}` }]).passed).toBe(false);
  });
});

describe("signed workspace grants", () => {
  it("binds capability grants to the artifact and session", () => {
    const token = signCapabilityToken("session-a", crypto.randomUUID(), ["ledger.snapshot", "market.quote"]);
    expect(verifyCapabilityToken(token, "session-a")?.grants).toEqual(["ledger.snapshot", "market.quote"]);
    expect(verifyCapabilityToken(token, "session-b")).toBeNull();
    expect(verifyCapabilityToken(`${token}x`, "session-a")).toBeNull();
  });

  it("signs an artifact's identity, content hash, session, and exact grants", () => {
    const artifactId = crypto.randomUUID();
    const hash = "a".repeat(64);
    const signature = signArtifactSignature("session-a", artifactId, hash, ["market.quote"]);
    expect(verifyArtifactSignature(signature, "session-a", artifactId, hash, ["market.quote"])).toBe(true);
    expect(verifyArtifactSignature(signature, "session-a", artifactId, "b".repeat(64), ["market.quote"])).toBe(false);
    expect(verifyArtifactSignature(signature, "session-b", artifactId, hash, ["market.quote"])).toBe(false);
  });

  it("binds the one-round clarification token to the active project", () => {
    const projectId = crypto.randomUUID();
    const token = signClarificationToken("session-a", "Build a planner", projectId);
    expect(verifyClarificationToken(token, "session-a")).toMatchObject({ originalPrompt: "Build a planner", activeProjectId: projectId });
    expect(verifyClarificationToken(token, "session-b")).toBeNull();
  });
});

describe("iframe capability input contracts", () => {
  it("accepts bounded broker inputs and rejects malformed or oversized RPC payloads", () => {
    expect(parseCapabilityInput("market.timeSeries", { symbol: "AAPL", interval: "1day", outputsize: 60 })).toMatchObject({ symbol: "AAPL" });
    expect(() => parseCapabilityInput("research.webSearch", { query: "mortgage rates", allowedDomains: ["https://bad.test/path"] })).toThrow();
    expect(() => parseCapabilityInput("workspace.state", { operation: "set", key: "../escape", value: 1 })).toThrow();
    expect(() => parseCapabilityInput("ai.analyze", { task: "Analyze this", context: "x".repeat(21_000), depth: "quick" })).toThrow("20 KB");
    expect(() => parseCapabilityInput("file.export", { filename: "large", data: "x".repeat(2_100_000), format: "json" })).toThrow("2 MB");
  });
});

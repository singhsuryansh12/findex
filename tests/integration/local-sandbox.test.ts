import type OpenAI from "openai";
import type { Responses } from "openai/resources/responses/responses";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceBuildPlan, WorkspaceFile } from "@/lib/workspaces/contracts";
import { generateWorkspace } from "@/lib/workspaces/generator";
import { validateAndBundleWorkspace } from "@/lib/workspaces/sandbox";
import { WorkspaceValidationError } from "@/lib/workspaces/validation-errors";

const enabled = process.env.RUN_LOCAL_SANDBOX_EVAL === "1";

function toolResponse(id: string, name: string, args: Record<string, unknown>) {
  return {
    id,
    status: "completed",
    output: [{ type: "function_call", id: `${id}_item`, call_id: `${id}_call`, name, arguments: JSON.stringify(args), status: "completed" }],
    incomplete_details: null,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  } as unknown as Responses.Response;
}

describe.skipIf(!enabled)("local workspace sandbox parity", () => {
  it("runs typecheck, unit policy, bundle, Chromium interaction, and screenshots", async () => {
    const files: WorkspaceFile[] = [{
      path: "src/App.tsx",
      content: `import React,{useState} from "react";import {useWorkspaceState} from "@findex/workspace-sdk";import "./styles.css";export default function App(){const [scenario,setScenario,ready]=useWorkspaceState("fire-validation",{currentAge:30,targetAge:50,annualReturn:7});const [notice,setNotice]=useState("Results ready.");const valid=Number.isInteger(scenario.currentAge)&&Number.isInteger(scenario.targetAge)&&scenario.currentAge>0&&scenario.currentAge<=100&&scenario.targetAge>scenario.currentAge&&scenario.targetAge<=120;const projection=valid?Math.round(100000*Math.pow(1+scenario.annualReturn/100,scenario.targetAge-scenario.currentAge)):"Check inputs";const update=(key:"currentAge"|"targetAge"|"annualReturn")=>(event:React.ChangeEvent<HTMLInputElement>)=>setScenario({...scenario,[key]:Number(event.target.value)});const commit=()=>setNotice("Projection recalculated for the updated assumption.");return <main><h1>Interactive FIRE verification lab</h1><label htmlFor="current-age">Current age</label><p id="current-age-help">Age in whole years, from 18 to 100.</p><input id="current-age" required type="number" min="18" max="100" step="1" value={scenario.currentAge} onChange={update("currentAge")} onBlur={commit} aria-invalid={!Number.isInteger(scenario.currentAge)||scenario.currentAge<18||scenario.currentAge>100} aria-describedby="current-age-help"/><label htmlFor="target-age">Target retirement age</label><p id="target-age-help">Age in whole years, from 19 to 120.</p><input id="target-age" required type="number" min="19" max="120" step="1" value={scenario.targetAge} onChange={update("targetAge")} onBlur={commit} aria-invalid={!Number.isInteger(scenario.targetAge)||scenario.targetAge<=scenario.currentAge||scenario.targetAge>120} aria-describedby="target-age-help"/><label htmlFor="annual-return">Expected annual investment return</label><p id="annual-return-help">Annual return in percent, from -99 to 100.</p><input id="annual-return" required type="number" min="-99" max="100" step="0.1" value={scenario.annualReturn} onChange={update("annualReturn")} onBlur={commit} aria-invalid={scenario.annualReturn< -99||scenario.annualReturn>100} aria-describedby="annual-return-help"/><span>FIRE number at target age</span><output aria-label="FIRE number at target age">{projection}</output><p>{ready?"Scenario ready":"Loading scenario"}</p><p role="status" aria-live="polite">{notice}</p><p>Educational, not financial advice.</p></main>}`,
    }, { path: "src/styles.css", content: "main{max-width:720px;margin:auto;padding:24px}input{width:100%}" }];
    const plan: WorkspaceBuildPlan = {
      schemaVersion: 2, intent: "create", title: "Interactive FIRE verification lab", goal: "Verify local SDK parity", response: "",
      assumptions: ["Constant annual return"], inputs: [
        { id: "current_age", label: "Current age", type: "number", description: "Current age", required: true, defaultValue: "30", min: "18", max: "100", step: "1" },
        { id: "target_age", label: "Target retirement age", type: "number", description: "Retirement age", required: true, defaultValue: "50", min: "19", max: "120", step: "1" },
        { id: "annual_return", label: "Expected annual investment return", type: "percentage", description: "Nominal annual return", required: true, defaultValue: "7", min: "-99", max: "100", step: "0.1" },
      ],
      outputs: [{ id: "fire_target", label: "Projected FIRE number at target age", description: "Projected portfolio", format: "USD" }],
      interactions: ["Changing any valid input updates the projected result"], layout: ["Responsive single view"], dataNeeds: [],
      persistence: { enabled: true, stateSchemaVersion: 1, description: "Save the scenario" }, capabilities: ["workspace.state"],
      disclosures: ["Educational only"], acceptanceCriteria: ["Every input independently changes the rendered result"], clarificationQuestions: [],
    };
    const result = await validateAndBundleWorkspace(files, "simple", plan);
    expect(result.executor).toBe("local");
    expect(result.screenshots?.desktop.length).toBeGreaterThan(100);
    expect(result.screenshots?.mobile.length).toBeGreaterThan(100);
    expect(result.checks.find((check) => check.name === "Chromium interaction")?.passed).toBe(true);
  }, 120_000);

  it("rejects fractional whole-year ages that application validation silently accepts", async () => {
    const files: WorkspaceFile[] = [{
      path: "src/App.tsx",
      content: `import React,{useState} from "react";import "./styles.css";export default function App(){const [age,setAge]=useState("50");const numeric=Number(age);const invalid=age.trim()===""||numeric<19||numeric>110;const years=numeric-30;const points=invalid?[]:Array.from({length:years+1},(_,year)=>100000+year*10000);const projection=points.length?points[points.length-1]:null;return <main><h1>Whole-year validation regression</h1><label htmlFor="age">Target retirement age</label><p id="age-help">Target age in whole years, from 19 to 110.</p><input id="age" required type="number" min="19" max="110" step="1" value={age} onChange={event=>setAge(event.target.value)} aria-invalid={invalid} aria-describedby="age-help"/><span>Projected portfolio at target age</span><output aria-label="Projected portfolio at target age">{projection??"Check inputs"}</output><p role="status" aria-live="polite">{invalid?"Correct the input.":"Projection recalculated."}</p><p>Educational, not financial advice.</p></main>}`,
    }, { path: "src/styles.css", content: "main{max-width:720px;margin:auto;padding:24px}input{width:100%;box-sizing:border-box}" }];
    const plan: WorkspaceBuildPlan = {
      schemaVersion: 2, intent: "create", title: "Whole-year validation regression", goal: "Reject fractional target ages", response: "",
      assumptions: ["Annual projection"],
      inputs: [{ id: "target_age", label: "Target retirement age", type: "number", description: "Target retirement age in years", required: true, defaultValue: "50", min: "19", max: "110", step: "1" }],
      outputs: [{ id: "portfolio", label: "Projected portfolio at target age", description: "Portfolio at target age", format: "USD" }],
      interactions: ["Changing target age updates the projection"], layout: ["Responsive single view"], dataNeeds: [],
      persistence: { enabled: false, stateSchemaVersion: 1, description: "" }, capabilities: [], disclosures: ["Educational only"],
      acceptanceCriteria: ["Fractional ages do not produce a mislabeled projection"], clarificationQuestions: [],
    };

    try {
      await validateAndBundleWorkspace(files, "standard", plan);
      throw new Error("Expected the host quality contract to reject fractional whole-year handling.");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceValidationError);
      expect((error as WorkspaceValidationError).diagnostics.join("\n")).toContain("off-step value");
    }
  }, 120_000);

  it("rejects hidden units, invalid-state persistence, and per-keystroke result announcements together", async () => {
    const files: WorkspaceFile[] = [{
      path: "src/App.tsx",
      content: `import React,{useState} from "react";import "./styles.css";export default function App(){const [spend,setSpend]=useState("0");const [rate,setRate]=useState("4");const [saved,setSaved]=useState(false);const spendNumber=Number(spend);const rateNumber=Number(rate);const spendError=spend.trim()===""||spendNumber<0||spendNumber>1000000000;const rateError=rate.trim()===""||rateNumber<=0||rateNumber>100;const target=!spendError&&!rateError?Math.round(spendNumber/(rateNumber/100)):null;return <main><h1>FIRE quality regression</h1><label htmlFor="spend">Annual spending <span aria-hidden="true">$</span></label><p id="spend-help">Expected retirement spending each year.</p><input id="spend" required type="number" min="0" max="1000000000" step="100" value={spend} onChange={(event)=>setSpend(event.target.value)} aria-invalid={spendError} aria-describedby={spendError?"spend-help spend-error":"spend-help"}/>{spendError&&<p id="spend-error">Enter valid spending.</p>}<label htmlFor="rate">Withdrawal rate <span aria-hidden="true">%</span></label><p id="rate-help">Rate used to calculate the target.</p><input id="rate" required type="number" min="0.1" max="100" step="0.1" value={rate} onChange={(event)=>setRate(event.target.value)} aria-invalid={rateError} aria-describedby={rateError?"rate-help rate-error":"rate-help"}/>{rateError&&<p id="rate-error">Enter a valid rate.</p>}<span>FIRE target</span><output aria-label="FIRE target">{target??"Check inputs"}</output><p role="status" aria-live="polite">{target===null?"Results unavailable":"FIRE target "+target+", remaining gap 500000, estimated time 20 years, and projected balance 1300000."}</p><button type="button" onClick={()=>setSaved(true)}>Save scenario</button><p>{saved?"Saved":"Not saved"}</p><p>Educational, not financial advice.</p></main>}`,
    }, { path: "src/styles.css", content: "main{max-width:720px;margin:auto;padding:24px;color:#17221c;background:#fff}input{width:100%;box-sizing:border-box}" }];
    const plan: WorkspaceBuildPlan = {
      schemaVersion: 2, intent: "create", title: "FIRE quality regression", goal: "Verify the quality contract", response: "",
      assumptions: ["4% withdrawal rate"], inputs: [
        { id: "annual_spend", label: "Annual spending", type: "currency", description: "Annual retirement spending", required: true, defaultValue: "60000", min: "0", max: "1000000000", step: "100" },
        { id: "withdrawal_rate", label: "Withdrawal rate", type: "percentage", description: "Withdrawal percentage", required: true, defaultValue: "4", min: "0.1", max: "100", step: "0.1" },
      ],
      outputs: [{ id: "fire_target", label: "FIRE target", description: "Annual spending divided by withdrawal rate", format: "USD" }],
      interactions: ["Inputs update the FIRE target"], layout: ["Responsive single view"], dataNeeds: [],
      persistence: { enabled: true, stateSchemaVersion: 1, description: "Save the scenario" }, capabilities: ["workspace.state"],
      disclosures: ["Educational information only; not financial advice."], acceptanceCriteria: ["Inputs update the FIRE target"], clarificationQuestions: [],
    };

    try {
      await validateAndBundleWorkspace(files, "standard", plan);
      throw new Error("Expected the host quality contract to reject the workspace.");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceValidationError);
      const diagnostics = (error as WorkspaceValidationError).diagnostics.join("\n");
      expect(diagnostics).toContain("must initialize to planned default");
      expect(diagnostics).toContain("accessible label/help text does not identify its unit");
      expect(diagnostics).toContain("Save must be disabled while assumptions are invalid");
      expect(diagnostics).toContain("not a multi-output summary");
    }
  }, 120_000);

  it("accepts a visible chart summary and table when Recharts drops aria-describedby", async () => {
    const files: WorkspaceFile[] = [{
      path: "src/App.tsx",
      content: `import React,{useMemo,useState} from "react";import {Line,LineChart,ResponsiveContainer,XAxis,YAxis} from "recharts";import "./styles.css";export default function App(){const [rate,setRate]=useState("7");const [horizon,setHorizon]=useState("40");const points=useMemo(()=>Array.from({length:Math.min(Number(horizon),2)+1},(_,year)=>({year,balance:Math.round(100000*Math.pow(1+Number(rate)/100,year))})),[rate,horizon]);return <main><h1>Projection accessibility regression</h1><label htmlFor="rate">Expected annual return <span>Required</span></label><p id="rate-help">Annual investment return in percent.</p><input id="rate" required type="number" min="-50" max="50" step="0.1" value={rate} onChange={event=>setRate(event.target.value)} aria-describedby="rate-help" aria-invalid={rate.trim()===""||Number(rate)<-50||Number(rate)>50}/><label htmlFor="horizon">Planning horizon <span>Required</span></label><p id="horizon-help">Planning period in years.</p><input id="horizon" required type="number" min="1" max="100" step="1" value={horizon} onChange={event=>setHorizon(event.target.value)} aria-describedby="horizon-help" aria-invalid={horizon.trim()===""||Number(horizon)<1||Number(horizon)>100}/><section><h2>Projection</h2><p className="chart-summary" id="projection-summary">Projected annual balances based on the selected return assumption.</p><ResponsiveContainer width="100%" height={220}><LineChart data={points} role="img" aria-label="Projected annual balance line chart" aria-describedby="projection-summary"><XAxis dataKey="year"/><YAxis/><Line dataKey="balance"/></LineChart></ResponsiveContainer><table><caption>Annual projection data</caption><thead><tr><th>Year</th><th>Balance</th></tr></thead><tbody>{points.map(point=><tr key={point.year}><td>{point.year}</td><td>{point.balance}</td></tr>)}</tbody></table></section><p role="status" aria-live="polite">Projection recalculated.</p><p>Educational only, not financial advice.</p></main>}`,
    }, { path: "src/styles.css", content: "main{max-width:720px;margin:auto;padding:24px}input{width:100%;box-sizing:border-box}section{min-width:0}table{width:100%}" }];
    const plan: WorkspaceBuildPlan = {
      schemaVersion: 2, intent: "create", title: "Projection accessibility regression", goal: "Verify chart alternatives", response: "",
      assumptions: ["Constant annual return"],
      inputs: [
        { id: "annual_return", label: "Expected annual return", type: "percentage", description: "Nominal annual return", required: true, defaultValue: "7", min: "-50", max: "50", step: "0.1" },
        { id: "planning_horizon", label: "Planning horizon", type: "number", description: "Projection period in years", required: true, defaultValue: "40", min: "1", max: "100", step: "1" },
      ],
      outputs: [{ id: "projection", label: "Projection", description: "Annual projected balances", format: "chart" }],
      interactions: ["Changing the return updates the projection"], layout: ["Responsive single view"], dataNeeds: [],
      persistence: { enabled: false, stateSchemaVersion: 1, description: "" }, capabilities: [],
      disclosures: ["Educational only"], acceptanceCriteria: ["The chart has a visible summary and annual data table"], clarificationQuestions: [],
    };

    const result = await validateAndBundleWorkspace(files, "standard", plan);
    expect(result.checks.find((check) => check.name === "Chromium interaction")?.passed).toBe(true);
  }, 120_000);

  it("uses one actionable browser repair and then publishes the corrected workspace", async () => {
    const styles = { path: "src/styles.css", content: "main{max-width:720px;margin:auto;padding:24px}input{width:100%}" };
    // Passes static host preflight (labels/defaults/bounds) but fails Chromium because
    // withdrawal rate is text-only, not an interactive control.
    const badSource = `import React,{useState} from "react";import "./styles.css";export default function App(){const [spend,setSpend]=useState(60000);return <main><h1>FIRE planner</h1><label htmlFor="spend">Annual spending</label><p id="spend-help">Retirement spending in US dollars per year.</p><input id="spend" required type="number" min="0" max="1000000000" step="100" value={spend} onChange={(event)=>setSpend(Number(event.target.value))} aria-describedby="spend-help"/><p>Withdrawal rate assumption remains fixed at 4 percent.</p><span>FIRE target</span><output aria-label="FIRE target">{spend*25}</output><p role="status" aria-live="polite">Results ready.</p><p>Educational information only; not financial advice.</p></main>}`;
    const fixedSource = `import React,{useState} from "react";import "./styles.css";export default function App(){const [spend,setSpend]=useState(60000);const [withdrawal,setWithdrawal]=useState(4);const [notice,setNotice]=useState("Results ready.");const commit=()=>setNotice("FIRE target recalculated for the updated assumption.");return <main><h1>FIRE planner</h1><label htmlFor="spend">Annual spending</label><p id="spend-help">Retirement spending in US dollars per year.</p><input id="spend" required type="number" min="0" max="1000000000" step="100" value={spend} onChange={(event)=>setSpend(Number(event.target.value))} onBlur={commit} aria-invalid={spend<0||spend>1000000000} aria-describedby="spend-help"/><label htmlFor="withdrawal">Withdrawal rate</label><p id="withdrawal-help">Annual withdrawal rate in percent.</p><input id="withdrawal" required type="number" min="0.1" max="100" step="0.1" value={withdrawal} onChange={(event)=>setWithdrawal(Number(event.target.value))} onBlur={commit} aria-invalid={withdrawal<0.1||withdrawal>100} aria-describedby="withdrawal-help"/><span>FIRE target</span><output aria-label="FIRE target">{Math.round(spend/(withdrawal/100))}</output><p role="status" aria-live="polite">{notice}</p><p>Educational information only; not financial advice.</p></main>}`;
    const create = vi.fn()
      .mockResolvedValueOnce(toolResponse("initial_write", "write_workspace", {
        files: [{ path: "src/App.tsx", content: badSource }, styles],
        summary: "Initial FIRE planner",
      }))
      .mockImplementation(async () => toolResponse(`repair_write_${create.mock.calls.length}`, "write_workspace", {
        files: [{ path: "src/App.tsx", content: fixedSource }, styles],
        summary: "Corrected FIRE planner",
      }));
    const passedReview = {
      passed: true,
      score: 96,
      issues: [],
      strengths: ["The requested output is visible and interactive."],
      acceptanceResults: [{ criterion: "Annual spending updates FIRE target", passed: true, detail: "Verified by the sandbox." }],
    };
    const parse = vi.fn().mockResolvedValue({
      id: "review_response_repaired",
      status: "completed",
      output: [],
      output_parsed: passedReview,
      incomplete_details: null,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
    const client = { responses: { create, parse } } as unknown as OpenAI;
    const plan: WorkspaceBuildPlan = {
      schemaVersion: 2, intent: "create", title: "FIRE planner", goal: "Estimate a FIRE target", response: "",
      assumptions: ["4% withdrawal rate"], inputs: [
        { id: "annual_spend", label: "Annual spending", type: "currency", description: "Annual retirement spending", required: true, defaultValue: "60000", min: "0", max: "1000000000", step: "100" },
        { id: "withdrawal_rate", label: "Withdrawal rate", type: "percentage", description: "Assumed withdrawal rate", required: true, defaultValue: "4", min: "0.1", max: "100", step: "0.1" },
      ],
      outputs: [{ id: "fire_target", label: "FIRE target", description: "Annual spending multiplied by 25", format: "USD" }],
      interactions: ["Annual spending updates FIRE target"], layout: ["Responsive single view"], dataNeeds: [],
      persistence: { enabled: false, stateSchemaVersion: 1, description: "" }, capabilities: [],
      disclosures: ["Educational information only; not financial advice."], acceptanceCriteria: ["Annual spending updates FIRE target"], clarificationQuestions: [],
    };

    const artifact = await generateWorkspace({
      client,
      prompt: "Build a FIRE calculator for retirement planning.",
      plan,
      assessment: { level: "standard", riskFlags: [], rationale: "One responsive retirement calculator" },
      active: null,
      sessionId: "local-repair-session",
      initialUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      initialTimings: { assessmentMs: 1, planningMs: 1 },
      requestId: "local-browser-repair",
    });

    expect(create.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ tool_choice: { type: "function", name: "write_workspace" } });
    expect(create.mock.calls[0]?.[0]?.instructions).toContain("prefer a fast correct draft over ornate perfection");
    expect(create.mock.calls[0]?.[0]?.instructions).toContain("exact plan.defaultValue");
    expect(JSON.stringify(create.mock.calls.slice(1))).toMatch(/Withdrawal rate|min=0\.1|step=0\.1/);
    // Host contract-lint/preflight recovery corrects the draft before sandbox; that is not a Workflow repair.
    expect(artifact).toMatchObject({ repairCount: 0, validation: { passed: true }, complexity: { level: "standard" }, qualityTier: "verified" });
    expect(artifact.files.find((file) => file.path === "src/App.tsx")?.content).toContain('aria-label="FIRE target"');
    expect(artifact.files.find((file) => file.path === "src/App.tsx")?.content).toContain('htmlFor="withdrawal"');
  }, 180_000);
});

import { describe, expect, it } from "vitest";
import type { WorkspaceBuildPlan } from "@/lib/workspaces/contracts";
import { lintWorkspacePlanContract } from "@/lib/workspaces/contract-lint";

const plan: WorkspaceBuildPlan = {
  schemaVersion: 2,
  intent: "create",
  title: "FIRE planner",
  goal: "Plan financial independence",
  response: "",
  assumptions: ["4% withdrawal"],
  inputs: [{
    id: "annual_spend",
    label: "Annual spending",
    type: "currency",
    description: "Annual retirement spending",
    required: true,
    defaultValue: "60000",
    min: "1000",
    max: "500000",
    step: "1000",
  }],
  outputs: [{ id: "fire_target", label: "FIRE target", description: "Target nest egg", format: "USD" }],
  interactions: ["Spending updates target"],
  layout: ["Calculator"],
  dataNeeds: [],
  persistence: { enabled: false, stateSchemaVersion: 1, description: "none" },
  capabilities: [],
  disclosures: ["Educational information only; not financial advice."],
  acceptanceCriteria: ["Changing annual spending updates the target"],
  clarificationQuestions: [],
};

describe("workspace plan contract lint", () => {
  it("accepts a source set that covers labels, defaults, bounds, and disclosure", () => {
    const source = `import React, { useState } from "react";
export default function App() {
  const [annualSpend, setAnnualSpend] = useState(60000);
  return (
    <main>
      <h1>FIRE planner</h1>
      <label htmlFor="spend">Annual spending (USD)
        <input id="spend" type="number" required min={1000} max={500000} step={1000} value={annualSpend}
          onChange={(event) => setAnnualSpend(Number(event.target.value))} />
      </label>
      <p aria-label="FIRE target">FIRE target: {annualSpend * 25}</p>
      <p>Educational information only; not financial advice.</p>
    </main>
  );
}`;
    expect(lintWorkspacePlanContract(plan, [{ path: "src/App.tsx", content: source }])).toEqual({
      passed: true,
      diagnostics: [],
    });
  });

  it("flags missing labels, defaults, and numeric bounds", () => {
    const source = `export default function App() { return <main><h1>Tool</h1></main>; }`;
    const result = lintWorkspacePlanContract(plan, [{ path: "src/App.tsx", content: source }]);
    expect(result.passed).toBe(false);
    expect(result.diagnostics.join(" ")).toMatch(/Annual spending|60000|min|disclosure|FIRE target/i);
  });

  it("flags a missing visible heading", () => {
    const source = `export default function App() {
  return <main><p>Educational information only; not financial advice.</p></main>;
}`;
    const result = lintWorkspacePlanContract(plan, [{ path: "src/App.tsx", content: source }]);
    expect(result.passed).toBe(false);
    expect(result.diagnostics.join(" ")).toMatch(/h1 or h2/i);
  });

  it("flags planned defaults that are off-step using scaled step math", () => {
    const offStepPlan: WorkspaceBuildPlan = {
      ...plan,
      inputs: [{ ...plan.inputs[0]!, defaultValue: "60500", step: "1000" }],
    };
    const source = `import React, { useState } from "react";
export default function App() {
  const [annualSpend, setAnnualSpend] = useState(60500);
  return (
    <main>
      <h1>FIRE planner</h1>
      <label htmlFor="spend">Annual spending (USD)
        <input id="spend" type="number" required min={1000} max={500000} step={1000} value={annualSpend}
          onChange={(event) => setAnnualSpend(Number(event.target.value))} />
      </label>
      <p aria-label="FIRE target">FIRE target</p>
      <p>Educational information only; not financial advice.</p>
    </main>
  );
}`;
    const result = lintWorkspacePlanContract(offStepPlan, [{ path: "src/App.tsx", content: source }]);
    expect(result.passed).toBe(false);
    expect(result.diagnostics.join(" ")).toMatch(/off-step/i);
  });

  it("flags planned numeric bounds that are missing from source", () => {
    const source = `import React, { useState } from "react";
export default function App() {
  const [annualSpend, setAnnualSpend] = useState(60000);
  return (
    <main>
      <h1>FIRE planner</h1>
      <label htmlFor="spend">Annual spending (USD)
        <input id="spend" type="number" required min={0} max={999} step={50} value={annualSpend}
          onChange={(event) => setAnnualSpend(Number(event.target.value))} />
      </label>
      <p aria-label="FIRE target">FIRE target</p>
      <p>Educational information only; not financial advice.</p>
    </main>
  );
}`;
    const result = lintWorkspacePlanContract(plan, [{ path: "src/App.tsx", content: source }]);
    expect(result.passed).toBe(false);
    expect(result.diagnostics.join(" ")).toMatch(/min=1000|step=1000/i);
  });

  it("accepts planned bounds supplied through shared constants", () => {
    const source = `import React, { useState } from "react";
const BOUNDS = { min: 1000, max: 500000, step: 1000 };
export default function App() {
  const [annualSpend, setAnnualSpend] = useState(60000);
  return (
    <main>
      <h1>FIRE planner</h1>
      <label htmlFor="spend">Annual spending (USD)
        <input id="spend" type="number" required min={BOUNDS.min} max={BOUNDS.max} step={BOUNDS.step} value={annualSpend}
          onChange={(event) => setAnnualSpend(Number(event.target.value))} />
      </label>
      <p aria-label="FIRE target">FIRE target</p>
      <p>Educational information only; not financial advice.</p>
    </main>
  );
}`;
    expect(lintWorkspacePlanContract(plan, [{ path: "src/App.tsx", content: source }])).toEqual({
      passed: true,
      diagnostics: [],
    });
  });

  it("requires planned output labels verbatim", () => {
    const source = `import React, { useState } from "react";
export default function App() {
  const [annualSpend, setAnnualSpend] = useState(60000);
  return (
    <main>
      <h1>FIRE planner</h1>
      <label htmlFor="spend">Annual spending (USD)
        <input id="spend" type="number" required min={1000} max={500000} step={1000} value={annualSpend}
          onChange={(event) => setAnnualSpend(Number(event.target.value))} />
      </label>
      <p aria-label="Nest egg">Target: {annualSpend * 25}</p>
      <p>Educational information only; not financial advice.</p>
    </main>
  );
}`;
    const result = lintWorkspacePlanContract(plan, [{ path: "src/App.tsx", content: source }]);
    expect(result.passed).toBe(false);
    expect(result.diagnostics.join(" ")).toMatch(/verbatim|FIRE target/i);
  });
});

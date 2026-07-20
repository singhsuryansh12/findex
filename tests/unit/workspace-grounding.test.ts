import { describe, expect, it } from "vitest";
import { applyLedgerGrounding, defaultLedgerCapabilitiesForPrompt, isMyMoneyBuildPrompt } from "@/lib/workspaces/grounding";
import type { WorkspaceBuildPlan } from "@/lib/workspaces/contracts";

function plan(partial?: Partial<WorkspaceBuildPlan>): WorkspaceBuildPlan {
  return {
    schemaVersion: 2,
    intent: "create",
    title: "Wealth projection",
    goal: "Project wealth",
    response: "",
    assumptions: [],
    inputs: [],
    outputs: [],
    interactions: [],
    layout: ["responsive"],
    dataNeeds: [],
    persistence: { enabled: false, stateSchemaVersion: 1, description: "" },
    capabilities: [],
    disclosures: ["Educational only; not financial advice."],
    acceptanceCriteria: ["Loads"],
    clarificationQuestions: [],
    ...partial,
  };
}

describe("ledger grounding", () => {
  it("detects my-money build prompts", () => {
    expect(isMyMoneyBuildPrompt("Build a wealth projection tool based on my systematic investments")).toBe(true);
    expect(isMyMoneyBuildPrompt("Build a FIRE calculator for me to plan my retirement.")).toBe(false);
  });

  it("default-grants ledger capabilities for personal wealth tools", () => {
    const grants = defaultLedgerCapabilitiesForPrompt("Build a wealth projection grounded in my portfolio and cash flow");
    expect(grants).toEqual(expect.arrayContaining(["ledger.snapshot", "ledger.portfolio", "ledger.cashflow"]));
  });

  it("merges grants and SDK grounding notes into the plan", () => {
    const grounded = applyLedgerGrounding(plan(), "Build a tool using my spending and cash flow");
    expect(grounded.capabilities.some((item) => item.startsWith("ledger."))).toBe(true);
    expect(grounded.dataNeeds.join(" ")).toMatch(/workspace-sdk ledger/i);
  });
});

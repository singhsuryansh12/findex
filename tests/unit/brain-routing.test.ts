import { describe, expect, it } from "vitest";
import { classifyBrainIntent } from "@/lib/brain/routing";

describe("Financial Brain intent routing", () => {
  it("routes ordinary financial questions directly to the low-effort Q&A path", () => {
    expect(classifyBrainIntent("How much did I spend on dining out last month?", { hasActiveWorkspace: false, hasClarificationToken: false })).toBe("financial_question");
    expect(classifyBrainIntent("What is a FIRE calculator?", { hasActiveWorkspace: false, hasClarificationToken: false })).toBe("financial_question");
  });

  it("routes FIRE builds and workspace revisions through planning", () => {
    expect(classifyBrainIntent("Build a FIRE calculator for me to plan my retirement.", { hasActiveWorkspace: false, hasClarificationToken: false })).toBe("workspace");
    expect(classifyBrainIntent("I want a retirement planner with editable assumptions", { hasActiveWorkspace: false, hasClarificationToken: false })).toBe("workspace");
    expect(classifyBrainIntent("Change the withdrawal rate input", { hasActiveWorkspace: true, hasClarificationToken: false })).toBe("workspace");
  });

  it("always returns clarification continuations to the workspace path", () => {
    expect(classifyBrainIntent("4% and age 55", { hasActiveWorkspace: false, hasClarificationToken: true })).toBe("workspace");
  });
});

import { describe, expect, it } from "vitest";
import { createHandoff, getGuidance, getTryNextPrompts, type DemoView } from "@/lib/brain/guidance";

const views: DemoView[] = ["brain", "spending", "portfolio", "cash-flow"];

describe("brain guidance", () => {
  it("provides chips and help for every demo view", () => {
    for (const view of views) {
      const page = getGuidance(view);
      expect(page.chips.length).toBeGreaterThanOrEqual(2);
      expect(page.helpTitle.length).toBeGreaterThan(0);
      expect(page.helpBody.length).toBeGreaterThan(0);
      expect(page.capabilities).toHaveLength(3);
    }
  });

  it("frames Build as a personal tool kept in My tools", () => {
    const build = getGuidance("brain").capabilities.find((capability) => capability.title === "Build a tool");
    expect(build?.detail).toMatch(/your way/i);
    expect(build?.detail).toMatch(/My tools/);
  });

  it("keeps help bodies free of OS and Codex marketing language", () => {
    for (const view of views) {
      const page = getGuidance(view);
      const blob = [page.helpBody, ...page.capabilities.map((capability) => capability.detail)].join("\n");
      expect(blob).not.toMatch(/operating system/i);
      expect(blob).not.toMatch(/Codex/);
      expect(blob).not.toMatch(/Jordan/);
    }
  });

  it("grounds brain help in money picture plus build agency", () => {
    const brain = getGuidance("brain");
    expect(brain.helpBody).toMatch(/money picture/i);
    expect(brain.helpBody).toMatch(/build/i);
  });

  it("creates a spending handoff with a plain-language label", () => {
    const handoff = createHandoff("spending", "Where did my money go last month?");
    expect(handoff).toEqual({
      source: "spending",
      label: "Spending",
      prompt: "Where did my money go last month?",
    });
  });

  it("returns exactly two try-next prompts for brain", () => {
    expect(getTryNextPrompts("brain").length).toBeGreaterThanOrEqual(2);
    expect(getTryNextPrompts("brain")).toHaveLength(2);
  });

  it("excludes lastPrompt from try-next when alternatives exist", () => {
    const lastPrompt = "What bills and subscriptions are coming up?";
    const prompts = getTryNextPrompts("brain", lastPrompt);

    expect(prompts).toHaveLength(2);
    expect(prompts).not.toContain(lastPrompt);
  });
});

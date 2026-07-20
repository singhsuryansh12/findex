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

  it("creates a spending handoff with a plain-language label", () => {
    const handoff = createHandoff("spending", "Where did my money go last month?");
    expect(handoff).toEqual({
      source: "spending",
      label: "Spending",
      prompt: "Where did my money go last month?",
    });
  });

  it("returns try-next prompts for brain", () => {
    expect(getTryNextPrompts("brain").length).toBeGreaterThanOrEqual(2);
  });
});

import { describe, expect, it } from "vitest";
import { classifyPolishDiagnostics, summarizeUpgradeOffer } from "@/lib/workspaces/polish-classify";

describe("polish classification", () => {
  it("treats a11y and step attribute issues as safe polish", () => {
    expect(classifyPolishDiagnostics(["WCAG contrast on helper text", "off-step value must set step attribute"])).toBe("safe_polish");
  });

  it("treats chart table-alternative sampling as safe polish", () => {
    expect(classifyPolishDiagnostics([
      "Blocking accessibility defect: the projection table is only a sampled subset of the chart data (year 0, the final year, and five-year intervals).",
    ])).toBe("safe_polish");
  });

  it("offers formula and acceptance failures instead of auto-swapping", () => {
    expect(classifyPolishDiagnostics(["Acceptance criterion failed: Annual return accepts values from 0% to 100%"])).toBe("behavior_offer");
    expect(classifyPolishDiagnostics(["Incorrect financial formula for wealth projection"])).toBe("behavior_offer");
  });

  it("defaults ambiguous diagnostics to an offer", () => {
    expect(classifyPolishDiagnostics(["Something unexpected happened"])).toBe("behavior_offer");
    const offer = summarizeUpgradeOffer(["Formula mismatch on growth"]);
    expect(offer.changes[0]).toContain("Formula");
  });
});

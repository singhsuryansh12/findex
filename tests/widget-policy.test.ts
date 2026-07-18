import { describe, expect, it } from "vitest";
import {
  buildWidgetDataEnvelope,
  createFallbackArtifact,
  widgetSpecSchema,
} from "@/lib/widgets/contracts";
import { validateWidgetSource } from "@/lib/widgets/validator";

describe("widget data boundary", () => {
  it("caps and strips transactions before generation", () => {
    const spec = widgetSpecSchema.parse({
      kind: "spending_breakdown", title: "Dining explorer", goal: "Explore dining",
      controls: ["date_range"], visualizations: ["bar_chart"], requiredMetrics: ["monthly_spending"],
      transactionFilters: { categoryId: "dining", maxTransactions: 5 },
    });
    const envelope = buildWidgetDataEnvelope(spec);
    expect(envelope.transactions).toHaveLength(5);
    for (const transaction of envelope.transactions) {
      expect(Object.keys(transaction).sort()).toEqual(["amountCents", "category", "date", "id", "merchant"]);
      expect(transaction.category).toBe("Dining");
      expect(transaction).not.toHaveProperty("accountId");
      expect(transaction).not.toHaveProperty("memo");
    }
  });
});

describe("generated source policy", () => {
  it("accepts the versioned interactive FIRE fixture", () => {
    expect(validateWidgetSource(createFallbackArtifact().source)).toMatchObject({ passed: true, issues: [] });
  });

  it.each([
    ["network API", `export default function X(){fetch("https://bad.test");return <div/>}`],
    ["invalid import", `import x from "left-pad"; export default function X(){return <div>{x}</div>}`],
    ["dynamic import", `export default async function X(){await import("react");return <div/>}`],
    ["iframe", `export default function X(){return <iframe src="https://bad.test"/>}`],
    ["parent access", `export default function X(){window.parent.postMessage("x","*");return <div/>}`],
    ["unsafe HTML", `export default function X(){return <div dangerouslySetInnerHTML={{__html:"x"}}/>}`],
  ])("rejects %s", (_label, source) => {
    expect(validateWidgetSource(source).passed).toBe(false);
  });
});

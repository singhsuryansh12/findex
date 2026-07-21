import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BrainMarkdown } from "@/components/brain/brain-markdown";

describe("BrainMarkdown", () => {
  it("renders headings, emphasis, and GFM tables as HTML", () => {
    const html = renderToStaticMarkup(
      <BrainMarkdown
        content={[
          "Your **$145,450 portfolio** is close to target.",
          "",
          "### Takeaway",
          "",
          "| Asset class | Current | Target |",
          "|---|---|---|",
          "| U.S. equity | **61.1%** | 60.0% |",
        ].join("\n")}
      />,
    );

    expect(html).toContain("<strong>");
    expect(html).toContain("$145,450 portfolio");
    expect(html).toContain("<h3>");
    expect(html).toContain("Takeaway");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>");
    expect(html).toContain("U.S. equity");
    expect(html).not.toContain("|---|");
    expect(html).not.toContain("### Takeaway");
  });
});

import { describe, expect, it } from "vitest";
import { viewFromPath } from "@/lib/brain/navigation";

describe("viewFromPath", () => {
  it("maps demo paths", () => {
    expect(viewFromPath("/demo/brain")).toBe("brain");
    expect(viewFromPath("/demo/spending")).toBe("spending");
    expect(viewFromPath("/demo/portfolio")).toBe("portfolio");
    expect(viewFromPath("/demo/cash-flow")).toBe("cash-flow");
  });

  it("defaults unknown paths to brain", () => {
    expect(viewFromPath("/")).toBe("brain");
    expect(viewFromPath("/demo/unknown")).toBe("brain");
  });
});

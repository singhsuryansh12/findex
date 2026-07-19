import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("generated workspace scaffold", () => {
  it("contains a real default React application and no starter copy", async () => {
    const source = await readFile("src/App.tsx", "utf8");
    expect(source).toContain("export default");
    expect(source).not.toContain("Neutral workspace scaffold");
  });
});

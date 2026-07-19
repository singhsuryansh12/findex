import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/brain/route";

async function callBrain(message: string, extras: Record<string, unknown> = {}) {
  const response = await POST(new Request("http://localhost/api/brain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, history: [], ...extras }),
  }));
  return { response, text: await response.text() };
}

describe("Financial Brain route", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("WORKSPACE_EXECUTION_MODE", "disabled");
  });

  it("streams the exact dining answer from the trusted ledger", async () => {
    const { response, text } = await callBrain("How much did I spend on dining out last month?");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(text).toContain('"tool":"get_spending_summary"');
    expect(text).toContain("$366.21");
    expect(text).toContain("8 Dining transactions · Jun 1–30");
    expect(text).toContain('"type":"assistant_delta"');
  });

  it("never substitutes FIRE or a sample when live generation is unavailable", async () => {
    const { text } = await callBrain("Build a cash vs EMI decision tool for a large purchase");
    expect(text).toContain('"type":"workspace_failed"');
    expect(text).toContain("OPENAI_API_KEY");
    expect(text).not.toContain('"type":"workspace_published"');
    expect(text.toLowerCase()).not.toContain("fire runway");
    expect(text.toLowerCase()).not.toContain("verified sample");
  });

  it("bounds invalid prompts and active workspace payloads", async () => {
    const response = await POST(new Request("http://localhost/api/brain", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "x".repeat(1_001), history: [] }),
    }));
    expect(response.status).toBe(400);
  });
});

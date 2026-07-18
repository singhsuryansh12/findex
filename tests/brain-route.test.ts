import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/brain/route";

async function callBrain(message: string) {
  const response = await POST(new Request("http://localhost/api/brain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: `test-${crypto.randomUUID()}`, message, history: [] }),
  }));
  return { response, text: await response.text() };
}

describe("Financial Brain route", () => {
  beforeEach(() => vi.stubEnv("ENABLE_LIVE_WIDGETS", "false"));

  it("streams the required dining answer from the deterministic tool", async () => {
    const { response, text } = await callBrain("How much did I spend on dining out last month?");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(text).toContain('"tool":"get_spending_summary"');
    expect(text).toContain("$366.21");
    expect(text).toContain("8 Dining transactions · Jun 1–30");
  });

  it("returns a clearly labeled verified widget when live credentials are disabled", async () => {
    const { text } = await callBrain("Build me a FIRE calculator");
    const assistantText = text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)) as { type: string; delta?: string }).filter((event) => event.type === "text_delta").map((event) => event.delta).join("");
    expect(text).toContain('"type":"widget"');
    expect(text).toContain('"mode":"verified_sample"');
    expect(assistantText.toLowerCase()).toContain("live generation is not configured");
  });

  it("bounds invalid prompts", async () => {
    const response = await POST(new Request("http://localhost/api/brain", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "test-session", message: "x".repeat(501), history: [] }),
    }));
    expect(response.status).toBe(400);
  });
});

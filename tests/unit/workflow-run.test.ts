import { describe, expect, it } from "vitest";
import { encodeRunEvent, isTerminalRunStatus, parseRunStartIndex } from "@/lib/workspaces/run-events";

describe("durable Brain run event protocol", () => {
  it("resumes from a bounded absolute event index", () => {
    expect(parseRunStartIndex("5")).toBe(5);
    expect(parseRunStartIndex("-1")).toBe(0);
    expect(parseRunStartIndex("not-a-number")).toBe(0);
  });

  it("encodes stable SSE event IDs for duplicate-event idempotency", () => {
    const frame = encodeRunEvent({ type: "build_progress", phase: "coding", detail: "Findex is building" }, 7);
    expect(frame).toBe("id: 7\ndata: {\"type\":\"build_progress\",\"phase\":\"coding\",\"detail\":\"Findex is building\"}\n\n");
  });

  it("cancels only non-terminal runs", () => {
    expect(isTerminalRunStatus("pending")).toBe(false);
    expect(isTerminalRunStatus("running")).toBe(false);
    expect(isTerminalRunStatus("completed")).toBe(true);
    expect(isTerminalRunStatus("failed")).toBe(true);
    expect(isTerminalRunStatus("cancelled")).toBe(true);
  });
});

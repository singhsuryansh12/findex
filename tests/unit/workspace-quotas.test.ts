import { describe, expect, it } from "vitest";
import { consumeBrainTurn, consumeCapabilityCall, consumeWorkspaceBuild } from "@/lib/workspaces/quotas";

describe("anonymous demo quotas", () => {
  it("allows 25 turns and 10 builds per UTC day", () => {
    const state = { date: "2026-07-19", turns: 0, builds: 0 };
    expect(Array.from({ length: 25 }, () => consumeBrainTurn(state)).every(Boolean)).toBe(true);
    expect(consumeBrainTurn(state)).toBe(false);
    expect(Array.from({ length: 10 }, () => consumeWorkspaceBuild(state)).every(Boolean)).toBe(true);
    expect(consumeWorkspaceBuild(state)).toBe(false);
  });

  it("enforces 30 capability calls per minute and 20 AI/research calls per day", () => {
    const now = Date.parse("2026-07-19T12:00:00Z");
    const minute = { minute: [], day: "2026-07-19", aiCalls: 0 };
    for (let index = 0; index < 30; index += 1) expect(consumeCapabilityCall(minute, now + index, false)).toBeNull();
    expect(consumeCapabilityCall(minute, now + 31, false)).toContain("minute");

    const daily = { minute: [], day: "2026-07-19", aiCalls: 0 };
    for (let index = 0; index < 20; index += 1) expect(consumeCapabilityCall(daily, now + index * 61_000, true)).toBeNull();
    expect(consumeCapabilityCall(daily, now + 20 * 61_000, true)).toContain("Daily AI");
  });
});

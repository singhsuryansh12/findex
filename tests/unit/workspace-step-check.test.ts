import { describe, expect, it } from "vitest";
import { isOnStep, nearestOnStep } from "@/lib/workspaces/step-check";

describe("scaled step checks", () => {
  it("accepts values that land on 0.1 steps despite float noise", () => {
    expect(isOnStep(7, 0, 0.1)).toBe(true);
    expect(isOnStep(7.00000000001, 0, 0.1)).toBe(true);
    expect(isOnStep(7.05, 0, 0.1)).toBe(false);
  });

  it("snaps to the nearest on-step value within bounds", () => {
    expect(nearestOnStep(7.04, 0, 100, 0.1)).toBeCloseTo(7.0, 8);
    expect(nearestOnStep(7.06, 0, 100, 0.1)).toBeCloseTo(7.1, 8);
  });
});

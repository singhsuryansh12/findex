import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import GeneratedWidget from "./GeneratedWidget";

describe("GeneratedWidget", () => {
  it("renders and recomputes the FIRE projection", () => {
    render(<GeneratedWidget data={{
      persona: { age: 30 },
      aggregates: { netWorthCents: 3_500_000, monthlySpendingCents: 550_000 },
    }} />);
    expect(screen.getByRole("heading", { name: "FIRE runway" })).toBeInTheDocument();
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(3);
    fireEvent.change(sliders[0], { target: { value: "2500" } });
    expect(sliders[0]).toHaveValue("2500");
  });
});

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import GeneratedWidget from "./GeneratedWidget";
describe("GeneratedWidget", () => {
  it("renders with a data envelope", () => {
    render(<GeneratedWidget data={{ aggregates: { netWorthCents: 10000 } }} />);
    expect(screen.getByTestId("widget-ready")).toBeInTheDocument();
  });
});

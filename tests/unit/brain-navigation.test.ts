import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateWithTransition, viewFromPath } from "@/lib/brain/navigation";

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

describe("navigateWithTransition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls router.push immediately when prefers-reduced-motion is reduce", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }));

    vi.stubGlobal("window", { matchMedia });

    const push = vi.fn();
    const startViewTransition = vi.fn();

    vi.stubGlobal("document", {
      startViewTransition,
    });

    navigateWithTransition({ push }, "/demo/spending");

    expect(push).toHaveBeenCalledWith("/demo/spending");
    expect(startViewTransition).not.toHaveBeenCalled();
  });
});

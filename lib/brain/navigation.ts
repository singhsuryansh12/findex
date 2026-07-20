export type DemoView = "brain" | "spending" | "portfolio" | "cash-flow";

export function viewFromPath(pathname: string): DemoView {
  const candidate = pathname.split("/").filter(Boolean).at(-1);
  return candidate === "spending" || candidate === "portfolio" || candidate === "cash-flow" ? candidate : "brain";
}

type TransitionRouter = { push: (href: string) => void };

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function navigateWithTransition(router: TransitionRouter, href: string): void {
  if (prefersReducedMotion() || typeof document === "undefined" || !("startViewTransition" in document)) {
    router.push(href);
    return;
  }
  document.startViewTransition(() => {
    router.push(href);
  });
}

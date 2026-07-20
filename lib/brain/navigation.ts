export type DemoView = "brain" | "spending" | "portfolio" | "cash-flow";

export function viewFromPath(pathname: string): DemoView {
  const candidate = pathname.split("/").filter(Boolean).at(-1);
  return candidate === "spending" || candidate === "portfolio" || candidate === "cash-flow" ? candidate : "brain";
}

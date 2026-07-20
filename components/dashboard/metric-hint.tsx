import type { ReactNode } from "react";

export function MetricHint({ children }: { children: ReactNode }) {
  return <p className="fd-metric-hint">{children}</p>;
}

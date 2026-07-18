import React from "react";
import { Panel } from "./widget-kit";
export default function GeneratedWidget({ data }: { data: unknown }) {
  return <Panel><p data-testid="widget-ready">Widget ready.</p><pre>{JSON.stringify(data)}</pre></Panel>;
}

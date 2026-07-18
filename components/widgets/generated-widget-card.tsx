"use client";

import dynamic from "next/dynamic";
import { CheckCircle2, Clock3, Code2, RotateCw, ShieldCheck, Sparkles } from "lucide-react";
import type { WidgetArtifact } from "@/lib/widgets/contracts";

const WidgetSandbox = dynamic(
  () => import("./widget-sandbox").then((module) => module.WidgetSandbox),
  { ssr: false, loading: () => <div className="generated-loading">Preparing isolated preview…</div> },
);

export function GeneratedWidgetCard({ artifact, onRetry }: { artifact: WidgetArtifact; onRetry?: () => void }) {
  const live = artifact.mode === "live";
  return (
    <article className="panel generated-card" aria-label={artifact.title}>
      <header className="generated-header">
        <div>
          <div className={`generated-badge ${live ? "" : "fallback"}`}>
            {live ? <Sparkles size={11} /> : <ShieldCheck size={11} />}
            {live ? "Built live by Codex" : "Verified sample · live generation unavailable"}
          </div>
          <h2 className="panel-title">{artifact.title}</h2>
          <div className="panel-subtitle">{artifact.provenance}</div>
        </div>
        <div className="validation-row" aria-label="Artifact validation summary">
          <span><CheckCircle2 size={11} />{artifact.validation.checks.length} checks</span>
          <span><Clock3 size={11} />{artifact.durationMs ? `${(artifact.durationMs / 1000).toFixed(1)}s` : "fixture"}</span>
          {artifact.repairCount > 0 && <span><RotateCw size={11} />{artifact.repairCount} repair</span>}
          {!live && onRetry && <button className="source-action" onClick={onRetry}><RotateCw size={11} />Retry live build</button>}
        </div>
      </header>
      <div className="generated-preview"><WidgetSandbox artifact={artifact} /></div>
      <details className="source-details">
        <summary><Code2 size={11} />View generated source · {artifact.model}</summary>
        <pre className="source-code"><code>{artifact.source}</code></pre>
      </details>
    </article>
  );
}

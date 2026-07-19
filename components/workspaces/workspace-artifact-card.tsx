"use client";

import { CheckCircle2, Clock3, Code2, Database, RotateCw, Sparkles } from "lucide-react";
import type { WorkspaceArtifactV2 } from "@/lib/workspaces/contracts";
import { WorkspaceSandbox } from "@/components/workspaces/workspace-sandbox";

export function WorkspaceArtifactCard({ artifact, onRetry }: { artifact: WorkspaceArtifactV2; onRetry?: () => void }) {
  return (
    <article className="panel generated-card" aria-label={artifact.title}>
      <header className="generated-header">
        <div>
          <div className="generated-badge"><Sparkles size={11} />Generated workspace · v{artifact.version}</div>
          <h2 className="panel-title">{artifact.title}</h2>
          <div className="panel-subtitle">{artifact.provenance}</div>
        </div>
        <div className="validation-row" aria-label="Artifact validation summary">
          <span><CheckCircle2 size={11} />{artifact.validation.checks.length} checks</span>
          <span><Clock3 size={11} />{(artifact.durationMs / 1000).toFixed(1)}s</span>
          <span>{artifact.complexity.level} · {artifact.effort}</span>
          {artifact.repairCount > 0 && <span><RotateCw size={11} />{artifact.repairCount} repair</span>}
          {onRetry && <button className="source-action" onClick={onRetry}><RotateCw size={11} />Rebuild</button>}
        </div>
      </header>
      <div className="workspace-disclosures">
        <span><Database size={11} />Capabilities: {artifact.manifest.capabilities.length ? artifact.manifest.capabilities.join(", ") : "hypothetical inputs only"}</span>
        <span>Review {artifact.validation.review.score}/100</span>
        <span>Educational, not financial advice</span>
      </div>
      <div className="generated-preview"><WorkspaceSandbox key={artifact.id} artifact={artifact} /></div>
      <details className="source-details">
        <summary><Code2 size={11} />View plan and {artifact.files.length} generated source files · {artifact.model}</summary>
        <div className="workspace-plan-summary">
          <strong>Goal</strong><p>{artifact.plan.goal}</p>
          <strong>Complexity assessment</strong><p>{artifact.complexity.rationale}</p>
          <strong>Assumptions</strong><ul>{artifact.plan.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
        </div>
        {artifact.files.map((file) => <pre className="source-code" key={file.path}><b>{file.path}</b>{"\n\n"}<code>{file.content}</code></pre>)}
      </details>
    </article>
  );
}

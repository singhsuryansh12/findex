"use client";

import { useState } from "react";
import { Copy, History, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { WorkspaceArtifactV2, WorkspaceProject } from "@/lib/workspaces/contracts";

export function WorkspaceLibrary({
  projects,
  activeProjectId,
  versions,
  storageWarning,
  onNew,
  onSelect,
  onRename,
  onDuplicate,
  onDelete,
  onRestore,
}: {
  projects: WorkspaceProject[];
  activeProjectId: string | null;
  versions: WorkspaceArtifactV2[];
  storageWarning: boolean;
  onNew: () => void;
  onSelect: (projectId: string) => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRestore: (artifact: WorkspaceArtifactV2) => void;
}) {
  const active = projects.find((project) => project.id === activeProjectId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  return (
    <section className="workspace-library" aria-label="Saved workspace library">
      <div className="workspace-library-main">
        <div>
          <div className="section-eyebrow">Adaptive workspace library</div>
          {editing ? (
            <form className="workspace-rename" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onRename(name); setEditing(false); }}>
              <input aria-label="Workspace name" value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} autoFocus />
              <button type="submit">Save</button>
            </form>
          ) : <h2>{active?.name ?? "No workspace selected"}</h2>}
        </div>
        <div className="workspace-library-actions">
          {projects.length > 0 && (
            <select aria-label="Select saved workspace" value={activeProjectId ?? ""} onChange={(event) => onSelect(event.target.value)}>
              {!activeProjectId && <option value="">Select workspace</option>}
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          )}
          <button onClick={onNew}><Plus size={12} />New</button>
          {active && <button onClick={() => { setName(active.name); setEditing(true); }}><Pencil size={12} />Rename</button>}
          {active && <button onClick={onDuplicate}><Copy size={12} />Duplicate</button>}
          {active && <button className="danger" onClick={onDelete}><Trash2 size={12} />Delete</button>}
        </div>
      </div>
      {storageWarning && <div className="workspace-storage-warning" role="status">Browser storage is over 80% full. Delete a workspace or version before the next build.</div>}
      {versions.length > 1 && (
        <details className="workspace-history">
          <summary><History size={12} />Version history · {versions.length}</summary>
          <div>
            {versions.map((version, index) => (
              <button key={version.id} onClick={() => onRestore(version)} disabled={index === 0}>
                <span>v{version.version} · {new Date(version.generatedAt).toLocaleString()}</span>
                {index === 0 ? <b>Current</b> : <><RotateCcw size={11} />Restore</>}
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import type { WorkspaceArtifactV2 } from "@/lib/workspaces/contracts";
import { capabilityNameSchema } from "@/lib/workspaces/contracts";
import { exportInputSchema, parseCapabilityInput, stateInputSchema } from "@/lib/workspaces/capability-inputs";
import { readWorkspaceState, writeWorkspaceState } from "@/lib/workspaces/persistence";

const rpcSchema = z.object({
  type: z.literal("findex:rpc"),
  nonce: z.string().uuid(),
  id: z.string().min(1).max(80),
  capability: capabilityNameSchema,
  input: z.unknown(),
});

function csvCell(value: unknown) {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(value: unknown) {
  if (!Array.isArray(value) || !value.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
    return `value\n${csvCell(value)}`;
  }
  const records = value as Array<Record<string, unknown>>;
  const headers = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return [headers.map(csvCell).join(","), ...records.map((record) => headers.map((key) => csvCell(record[key])).join(","))].join("\n");
}

function downloadExport(input: z.infer<typeof exportInputSchema>) {
  const filename = input.filename.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/\.+/g, ".");
  const content = input.format === "csv" ? toCsv(input.data) : JSON.stringify(input.data, null, 2);
  const blob = new Blob([content], { type: input.format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(`.${input.format}`) ? filename : `${filename}.${input.format}`;
  anchor.click();
  URL.revokeObjectURL(url);
  return { exported: true, filename: anchor.download };
}

function sourceDocument(artifact: WorkspaceArtifactV2, nonce: string) {
  const javascript = artifact.bundle.javascript.replace(/<\/script/gi, "<\\/script");
  const css = artifact.bundle.css.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>${css}</style></head><body><div id="root"></div><script nonce="${nonce}">${javascript}</script></body></html>`;
}

export function WorkspaceSandbox({ artifact }: { artifact: WorkspaceArtifactV2 }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<MessagePort | null>(null);
  const nonce = artifact.id;
  const [height, setHeight] = useState(460);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<"checking" | "valid" | "invalid">("checking");

  useEffect(() => {
    let active = true;
    void crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${artifact.bundle.javascript}\0${artifact.bundle.css}`),
    ).then((digest) => {
      const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      if (active) setIntegrity(actual === artifact.bundle.sha256 ? "valid" : "invalid");
    }).catch(() => { if (active) setIntegrity("invalid"); });
    return () => { active = false; };
  }, [artifact.bundle.css, artifact.bundle.javascript, artifact.bundle.sha256]);

  const srcDoc = useMemo(() => integrity === "valid" ? sourceDocument(artifact, nonce) : "", [artifact, integrity, nonce]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !srcDoc) return;
    const channel = new MessageChannel();
    portRef.current = channel.port1;
    let active = true;
    channel.port1.onmessage = async (event) => {
      if (!active || !event.data || event.data.nonce !== nonce) return;
      if (event.data.type === "findex:height" && Number.isFinite(event.data.height)) {
        setHeight(Math.max(430, Math.min(1_600, Number(event.data.height))));
        return;
      }
      if (event.data.type === "findex:runtime-error") {
        setRuntimeError(String(event.data.message ?? "The generated workspace encountered an error."));
        return;
      }
      const parsed = rpcSchema.safeParse(event.data);
      if (!parsed.success) return;
      const message = parsed.data;
      const respond = (ok: boolean, result?: unknown, error?: string) => channel.port1.postMessage({
        type: "findex:rpc-result", nonce, id: message.id, ok, result, error,
      });
      try {
        if (!artifact.manifest.capabilities.includes(message.capability)) throw new Error(`${message.capability} was not granted to this workspace.`);
        const validatedInput = parseCapabilityInput(message.capability, message.input);
        if (message.capability === "workspace.state") {
          const state = stateInputSchema.parse(validatedInput);
          if (state.operation === "get") respond(true, await readWorkspaceState(artifact.projectId, state.key));
          else { await writeWorkspaceState(artifact.projectId, state.key, state.value); respond(true, { saved: true }); }
          return;
        }
        if (message.capability === "file.export") {
          respond(true, downloadExport(exportInputSchema.parse(validatedInput)));
          return;
        }
        const response = await fetch("/api/workspace/capability", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            artifactId: artifact.id,
            artifactToken: artifact.capabilityToken,
            artifactHash: artifact.bundle.sha256,
            artifactSignature: artifact.artifactSignature,
            capability: message.capability,
            input: validatedInput,
          }),
        });
        const payload = await response.json() as { ok?: boolean; error?: string; result?: unknown; source?: string; freshAt?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Workspace capability failed.");
        respond(true, { data: payload.result, source: payload.source, freshAt: payload.freshAt });
      } catch (error) {
        respond(false, undefined, error instanceof Error ? error.message : "Workspace action failed.");
      }
    };
    channel.port1.start();
    const initialize = () => iframe.contentWindow?.postMessage({ type: "findex:init", nonce }, "*", [channel.port2]);
    iframe.addEventListener("load", initialize, { once: true });
    return () => {
      active = false;
      iframe.removeEventListener("load", initialize);
      channel.port1.close();
      portRef.current = null;
    };
  }, [artifact, nonce, srcDoc]);

  return (
    <div className="workspace-frame-wrap">
      {integrity === "checking" && <div className="workspace-integrity-status" role="status">Verifying workspace integrity…</div>}
      {integrity === "invalid" && <div className="workspace-runtime-error" role="alert">This saved workspace failed its integrity check and was not loaded.</div>}
      {runtimeError && <div className="workspace-runtime-error" role="alert">{runtimeError}</div>}
      {integrity === "valid" && <iframe
        ref={iframeRef}
        className="workspace-frame"
        title={`${artifact.title} interactive workspace`}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        style={{ height }}
      />}
    </div>
  );
}

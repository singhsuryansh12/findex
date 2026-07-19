import { createHash } from "node:crypto";
import path from "node:path";
import { build, type Loader, type Plugin } from "esbuild";
import type { WorkspaceFile } from "./contracts";

const entryPath = "src/__findex_entry.tsx";
const sdkPath = "@findex/workspace-sdk";

const runtimeSource = `import React, { useCallback, useEffect, useState } from "react";

let bridgePort = null;
let bridgeNonce = "";
let nextCall = 0;
const pending = new Map();

export function __findexConnect(port, nonce) {
  bridgePort = port;
  bridgeNonce = nonce;
  bridgePort.onmessage = (event) => {
    const message = event.data;
    if (!message || message.nonce !== bridgeNonce || message.type !== "findex:rpc-result") return;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.ok) task.resolve(message.result);
    else task.reject(new Error(message.error || "Workspace action failed."));
  };
  bridgePort.start();
}

function invoke(capability, input) {
  if (!bridgePort) return Promise.reject(new Error("Workspace bridge is not ready."));
  const id = String(++nextCall);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    bridgePort.postMessage({ type: "findex:rpc", nonce: bridgeNonce, id, capability, input });
  });
}

export const workspace = { invoke };

export function useCapability(capability) {
  return useCallback((input) => invoke(capability, input), [capability]);
}

export function useWorkspaceState(key, initialValue) {
  const [value, setValue] = useState(initialValue);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    invoke("workspace.state", { operation: "get", key }).then((stored) => {
      if (active && stored && stored.found) setValue(stored.value);
    }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [key]);
  const update = useCallback((next) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      void invoke("workspace.state", { operation: "set", key, value: resolved });
      return resolved;
    });
  }, [key]);
  return [value, update, ready];
}

export function exportWorkspaceData(filename, data, format = "json") {
  return invoke("file.export", { filename, data, format });
}
`;

const trustedEntrySource = `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { __findexConnect } from "@findex/workspace-sdk";

let started = false;
function start(event) {
  const message = event.data;
  const port = event.ports && event.ports[0];
  if (started || event.source !== parent || !port || !message || message.type !== "findex:init" || typeof message.nonce !== "string") return;
  started = true;
  window.removeEventListener("message", start);
  __findexConnect(port, message.nonce);
  window.addEventListener("error", (failure) => {
    port.postMessage({ type: "findex:runtime-error", nonce: message.nonce, message: failure.message || "Workspace runtime error." });
  });
  window.addEventListener("unhandledrejection", (failure) => {
    const reason = failure.reason instanceof Error ? failure.reason.message : String(failure.reason || "Workspace promise rejected.");
    port.postMessage({ type: "findex:runtime-error", nonce: message.nonce, message: reason });
  });
  const rootNode = document.getElementById("root");
  if (!rootNode) throw new Error("Workspace root is missing.");
  createRoot(rootNode).render(<App />);
  const observer = new ResizeObserver(() => {
    port.postMessage({ type: "findex:height", nonce: message.nonce, height: Math.ceil(document.documentElement.scrollHeight) });
  });
  observer.observe(document.documentElement);
  port.postMessage({ type: "findex:ready", nonce: message.nonce });
}
window.addEventListener("message", start);
`;

function loaderFor(filePath: string): Loader {
  if (filePath.endsWith(".tsx")) return "tsx";
  if (filePath.endsWith(".ts")) return "ts";
  return "css";
}

function resolveWorkspaceImport(importer: string, requested: string, files: Map<string, string>) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), requested));
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.css`, `${base}/index.ts`, `${base}/index.tsx`]
    .find((candidate) => files.has(candidate));
}

function workspacePlugin(sourceFiles: WorkspaceFile[]): Plugin {
  const files = new Map(sourceFiles.map((file) => [file.path, file.content]));
  files.set(entryPath, trustedEntrySource);
  return {
    name: "findex-workspace",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^findex-entry$/ }, () => ({ path: entryPath, namespace: "workspace" }));
      buildApi.onResolve({ filter: /^@findex\/workspace-sdk$/ }, () => ({ path: sdkPath, namespace: "findex-runtime" }));
      buildApi.onResolve({ filter: /^\./, namespace: "workspace" }, (args) => {
        const resolved = resolveWorkspaceImport(args.importer, args.path, files);
        return resolved ? { path: resolved, namespace: "workspace" } : { errors: [{ text: `Cannot resolve ${args.path} from ${args.importer}` }] };
      });
      buildApi.onLoad({ filter: /.*/, namespace: "workspace" }, (args) => ({
        contents: files.get(args.path),
        loader: loaderFor(args.path),
        resolveDir: process.cwd(),
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "findex-runtime" }, () => ({
        contents: runtimeSource,
        loader: "tsx",
        resolveDir: process.cwd(),
      }));
    },
  };
}

export type WorkspaceBundle = { javascript: string; css: string; sha256: string; bytes: number };

export async function bundleWorkspace(files: WorkspaceFile[]): Promise<WorkspaceBundle> {
  const result = await build({
    entryPoints: ["findex-entry"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: ["es2022"],
    jsx: "automatic",
    minify: true,
    treeShaking: true,
    legalComments: "none",
    plugins: [workspacePlugin(files)],
    outdir: "dist",
    logLevel: "silent",
  });
  const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
  const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
  if (!javascript) throw new Error("Workspace bundle did not produce JavaScript.");
  const bytes = Buffer.byteLength(javascript) + Buffer.byteLength(css);
  if (bytes > 2_000_000) throw new Error(`Workspace bundle is ${bytes.toLocaleString()} bytes; the limit is 2,000,000.`);
  return {
    javascript,
    css,
    bytes,
    sha256: createHash("sha256").update(javascript).update("\0").update(css).digest("hex"),
  };
}

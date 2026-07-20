import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { build, type Loader, type Plugin } from "esbuild";
import type { WorkspaceFile } from "./contracts";

const moduleRequire = createRequire(import.meta.url);
const entryPath = "src/__findex_entry.tsx";
const sdkPath = "@findex/workspace-sdk";
const hostPackageRoots = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
  "react-dom/client",
  "recharts",
  "lucide-react",
  "date-fns",
] as const;

/** Prefer the app project root — Workflow step bundles rewrite import.meta.url. */
function hostRequire() {
  const packageJson = path.join(process.cwd(), "package.json");
  if (existsSync(packageJson)) {
    try {
      return createRequire(packageJson);
    } catch {
      // Fall through to module-local require.
    }
  }
  return moduleRequire;
}

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

/** Resolve at call time so serverless/workflow step runtimes use the app node_modules. */
function resolveHostPackage(specifier: string) {
  const resolver = hostRequire();
  const searchRoots = [
    process.cwd(),
    path.join(process.cwd(), "node_modules"),
  ];
  try {
    const resolved = resolver.resolve(specifier, { paths: searchRoots });
    return existsSync(resolved) ? resolved : null;
  } catch {
    // Fall through.
  }
  try {
    const resolved = resolver.resolve(specifier);
    return existsSync(resolved) ? resolved : null;
  } catch {
    try {
      const resolved = moduleRequire.resolve(specifier, { paths: searchRoots });
      return existsSync(resolved) ? resolved : null;
    } catch {
      return null;
    }
  }
}

export function canResolveWorkspaceHostPackages() {
  return hostPackageRoots.every((specifier) => Boolean(resolveHostPackage(specifier)));
}

export function isMissingHostBundlerPackages(error: unknown) {
  const message = [
    error instanceof Error ? error.message : String(error ?? ""),
    typeof error === "object" && error && "errors" in error ? JSON.stringify((error as { errors?: unknown }).errors) : "",
  ].join("\n");
  return /Could not resolve ["']react(?:\/jsx-runtime)?["']|Could not resolve ["']react-dom(?:\/client)?["']|Cannot resolve host package|host bundler packages are unavailable/i.test(message);
}

function hostResolveDir() {
  const reactMain = resolveHostPackage("react");
  return reactMain ? path.dirname(path.dirname(path.dirname(reactMain))) : process.cwd();
}

function workspacePlugin(sourceFiles: WorkspaceFile[]): Plugin {
  const files = new Map(sourceFiles.map((file) => [file.path, file.content]));
  files.set(entryPath, trustedEntrySource);
  const resolveDir = hostResolveDir();
  return {
    name: "findex-workspace",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^findex-entry$/ }, () => ({ path: entryPath, namespace: "workspace" }));
      buildApi.onResolve({ filter: /^@findex\/workspace-sdk$/ }, () => ({ path: sdkPath, namespace: "findex-runtime" }));
      buildApi.onResolve({ filter: /^(react|react-dom|recharts|lucide-react|date-fns)(\/.*)?$/ }, (args) => {
        const resolved = resolveHostPackage(args.path);
        return resolved
          ? { path: resolved }
          : { errors: [{ text: `Cannot resolve host package ${args.path} in the Findex runtime.` }] };
      });
      buildApi.onResolve({ filter: /^\./, namespace: "workspace" }, (args) => {
        const resolved = resolveWorkspaceImport(args.importer, args.path, files);
        return resolved ? { path: resolved, namespace: "workspace" } : { errors: [{ text: `Cannot resolve ${args.path} from ${args.importer}` }] };
      });
      buildApi.onLoad({ filter: /.*/, namespace: "workspace" }, (args) => ({
        contents: files.get(args.path),
        loader: loaderFor(args.path),
        resolveDir,
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "findex-runtime" }, () => ({
        contents: runtimeSource,
        loader: "tsx",
        resolveDir,
      }));
    },
  };
}

export type WorkspaceBundle = { javascript: string; css: string; sha256: string; bytes: number };

function finalizeBundle(javascript: string, css: string): WorkspaceBundle {
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

export async function bundleWorkspace(files: WorkspaceFile[]): Promise<WorkspaceBundle> {
  if (!canResolveWorkspaceHostPackages()) {
    throw new Error("Workspace host bundler packages are unavailable in this runtime.");
  }
  const resolveDir = hostResolveDir();
  const nodePaths = [
    path.join(process.cwd(), "node_modules"),
    path.join(resolveDir, "node_modules"),
  ];
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
    absWorkingDir: resolveDir,
    nodePaths,
    plugins: [workspacePlugin(files)],
    outdir: "dist",
    logLevel: "silent",
  });
  const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
  const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
  return finalizeBundle(javascript, css);
}

/** Self-contained esbuild script executed inside the network-denied sandbox, where React exists on disk. */
export function sandboxPublishBuildSource() {
  return `import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const runtimeSource = ${JSON.stringify(runtimeSource)};
const trustedEntrySource = ${JSON.stringify(trustedEntrySource)};
const root = process.cwd();
const entryFile = path.join(root, "src/__findex_entry.tsx");
const sdkFile = path.join(root, "src/__findex_sdk.tsx");

mkdirSync(path.join(root, "src"), { recursive: true });
mkdirSync(path.join(root, "dist"), { recursive: true });
writeFileSync(sdkFile, runtimeSource, "utf8");
writeFileSync(entryFile, trustedEntrySource, "utf8");

const result = await build({
  entryPoints: [entryFile],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  jsx: "automatic",
  minify: true,
  treeShaking: true,
  legalComments: "none",
  absWorkingDir: root,
  plugins: [{
    name: "findex-publish-sdk",
    setup(api) {
      api.onResolve({ filter: new RegExp("^@findex/workspace-sdk$") }, () => ({ path: sdkFile }));
    },
  }],
  outdir: path.join(root, "dist"),
  logLevel: "silent",
});

const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
if (!javascript) throw new Error("Sandbox publish bundle did not produce JavaScript.");
const bytes = Buffer.byteLength(javascript) + Buffer.byteLength(css);
if (bytes > 2_000_000) throw new Error("Sandbox publish bundle exceeds 2,000,000 bytes.");
const sha256 = createHash("sha256").update(javascript).update("\\0").update(css).digest("hex");
writeFileSync(path.join(root, "dist/publish.js"), javascript, "utf8");
writeFileSync(path.join(root, "dist/publish.css"), css, "utf8");
writeFileSync(path.join(root, "dist/publish.json"), JSON.stringify({ bytes, sha256 }), "utf8");
`;
}

export function workspaceBundleFromPublishArtifacts(javascript: string, css: string, meta?: { bytes?: number; sha256?: string }): WorkspaceBundle {
  const bundle = finalizeBundle(javascript, css);
  if (meta?.bytes && meta.bytes !== bundle.bytes) {
    throw new Error("Sandbox publish metadata bytes did not match bundle contents.");
  }
  if (meta?.sha256 && meta.sha256 !== bundle.sha256) {
    throw new Error("Sandbox publish metadata digest did not match bundle contents.");
  }
  return bundle;
}

import { parse } from "@babel/parser";
import {
  ALLOWED_WORKSPACE_IMPORTS,
  type WorkspaceFile,
  type WorkspaceValidationReport,
} from "./contracts";

const allowedImports = new Set<string>(ALLOWED_WORKSPACE_IMPORTS);
const allowedFile = /^src\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:ts|tsx|css)$/;
const reservedFiles = new Set(["src/__findex_entry.tsx", "src/workspace-sdk.d.ts", "src/workspace.test.ts"]);
const bannedIdentifiers = new Set([
  "eval", "Function", "fetch", "XMLHttpRequest", "WebSocket", "EventSource",
  "Worker", "SharedWorker", "document", "window", "localStorage", "sessionStorage",
  "indexedDB", "navigator", "location", "open", "postMessage", "globalThis", "self",
  "process", "BroadcastChannel", "WebAssembly", "setInterval", "requestAnimationFrame",
  "setTimeout", "queueMicrotask",
]);
const bannedJsx = new Set(["script", "iframe", "object", "embed", "form", "a", "audio", "video"]);

type AstNode = Record<string, unknown> & { type?: string };

function memberPath(node: AstNode): string {
  if (node.type === "Identifier" || node.type === "JSXIdentifier") return String(node.name ?? "");
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return "";
  const object = memberPath(node.object as AstNode);
  const property = memberPath(node.property as AstNode);
  return object && property ? `${object}.${property}` : object || property;
}

function visit(value: unknown, onNode: (node: AstNode) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) visit(child, onNode);
    return;
  }
  const node = value as AstNode;
  if (typeof node.type === "string") onNode(node);
  for (const [key, child] of Object.entries(node)) {
    if (!new Set(["loc", "start", "end", "leadingComments", "trailingComments"]).has(key)) visit(child, onNode);
  }
}

function normalizeRelativeImport(importer: string, requested: string) {
  const parts = importer.split("/").slice(0, -1);
  for (const segment of requested.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

export type WorkspacePolicyResult = {
  passed: boolean;
  issues: string[];
  checks: WorkspaceValidationReport["checks"];
  sourceBytes: number;
};

export function validateWorkspaceFiles(files: WorkspaceFile[]): WorkspacePolicyResult {
  const issues = new Set<string>();
  const paths = new Set(files.map((file) => file.path));
  const sourceBytes = files.reduce((total, file) => total + new TextEncoder().encode(file.content).length, 0);
  let parsedModules = 0;
  let hasDefaultExport = false;

  if (!paths.has("src/App.tsx")) issues.add("The workspace must include src/App.tsx.");
  if (files.length > 80) issues.add("The workspace exceeds the 80-file limit.");
  if (paths.size !== files.length) issues.add("Workspace file paths must be unique.");
  if (sourceBytes > 256_000) issues.add("Workspace source exceeds the 256 KB limit.");

  for (const file of files) {
    if (!allowedFile.test(file.path) || file.path.includes("..") || reservedFiles.has(file.path)) {
      issues.add(`File '${file.path}' is outside the editable src TypeScript/CSS boundary.`);
      continue;
    }
    if (/\b(?:sk-proj|sk-or-v1|sk-ant|ghp|xox[baprs])-[A-Za-z0-9_-]{12,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(file.content)) {
      issues.add(`File '${file.path}' appears to contain a credential or private key.`);
    }
    if (file.path.endsWith(".css")) {
      if (/@import\b|url\s*\(\s*["']?(?!data:)/i.test(file.content)) {
        issues.add(`CSS file '${file.path}' contains a network import or unsafe URL.`);
      }
      continue;
    }

    try {
      const ast = parse(file.content, { sourceType: "module", plugins: ["jsx", "typescript"] });
      parsedModules += 1;
      visit(ast, (node) => {
        if (node.type === "ExportDefaultDeclaration" && file.path === "src/App.tsx") hasDefaultExport = true;
        if (node.type === "ImportDeclaration") {
          const requested = String((node.source as AstNode | undefined)?.value ?? "");
          if (requested.startsWith(".")) {
            const target = normalizeRelativeImport(file.path, requested);
            const exists = [target, `${target}.ts`, `${target}.tsx`, `${target}.css`, `${target}/index.ts`, `${target}/index.tsx`]
              .some((candidate) => paths.has(candidate));
            if (!exists || target.startsWith("../") || !target.startsWith("src/")) {
              issues.add(`Import '${requested}' from '${file.path}' escapes the workspace or does not exist.`);
            }
          } else if (!allowedImports.has(requested)) {
            issues.add(`Import '${requested}' is not allowed.`);
          }
        }
        if (node.type === "ImportExpression") issues.add("Dynamic imports are not allowed.");
        if (["WhileStatement", "DoWhileStatement", "ForStatement", "ForInStatement", "ForOfStatement"].includes(String(node.type))) {
          issues.add("Imperative loops are not allowed; use bounded array operations.");
        }
        if (node.type === "Identifier" && bannedIdentifiers.has(String(node.name))) {
          issues.add(`Browser, storage, or execution API '${String(node.name)}' is not allowed.`);
        }
        if (node.type === "CallExpression" && memberPath(node.callee as AstNode) === "globalThis.eval") {
          issues.add("Dynamic evaluation is not allowed.");
        }
        if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
          const path = memberPath(node);
          if (/^(?:parent|top|opener|frames)\./.test(path)) issues.add("Parent, opener, and frame access is not allowed.");
          if (/^history\.(?:pushState|replaceState|go|back|forward)$/.test(path)) issues.add("Navigation APIs are not allowed.");
        }
        if (node.type === "MetaProperty") issues.add("import.meta and similar runtime metadata are not allowed.");
        if (node.type === "JSXAttribute" && memberPath(node.name as AstNode) === "dangerouslySetInnerHTML") {
          issues.add("Unsafe HTML injection is not allowed.");
        }
        if (node.type === "JSXAttribute" && ["src", "href"].includes(memberPath(node.name as AstNode))) {
          const value = (node.value as AstNode | undefined)?.value;
          if (typeof value === "string" && /^(?:https?:|\/\/|javascript:)/i.test(value)) issues.add("External and executable element URLs are not allowed.");
        }
        if (node.type === "JSXOpeningElement") {
          const tag = memberPath((node.name ?? {}) as AstNode).toLowerCase();
          if (bannedJsx.has(tag)) issues.add(`<${tag}> elements are not allowed.`);
          if (tag === "input") {
            const attributes = Array.isArray(node.attributes) ? node.attributes as AstNode[] : [];
            const typeAttribute = attributes.find((attribute) => attribute.type === "JSXAttribute" && memberPath(attribute.name as AstNode) === "type");
            const typeValue = (typeAttribute?.value as AstNode | undefined)?.value;
            if (typeValue === "file") issues.add("File inputs are not allowed in generated workspaces.");
          }
        }
      });
    } catch (error) {
      issues.add(`${file.path}: ${error instanceof Error ? error.message : "invalid TypeScript"}`);
    }
  }

  if (!hasDefaultExport) issues.add("src/App.tsx must have a default export.");
  const passed = issues.size === 0;
  return {
    passed,
    issues: [...issues],
    sourceBytes,
    checks: [
      { name: "Source policy", passed, detail: passed ? "Files, imports, and browser APIs are within policy." : `${issues.size} issue(s) found.` },
      { name: "Source size", passed: sourceBytes <= 256_000, detail: `${sourceBytes.toLocaleString()} of 256,000 bytes` },
      { name: "Syntax", passed: parsedModules === files.filter((file) => !file.path.endsWith(".css")).length, detail: `${parsedModules} TypeScript module(s) parsed` },
    ],
  };
}

export function isEditableWorkspacePath(path: string) {
  return allowedFile.test(path) && !path.includes("..") && !reservedFiles.has(path);
}

import { parse } from "@babel/parser";
import type { WidgetValidation } from "./contracts";

const ALLOWED_IMPORTS = new Set(["react", "recharts", "./widget-kit"]);
const BANNED_IDENTIFIERS = new Set([
  "eval", "Function", "fetch", "XMLHttpRequest", "WebSocket", "EventSource",
  "Worker", "SharedWorker", "document", "localStorage", "sessionStorage",
]);
const BANNED_JSX = new Set(["script", "iframe", "object", "embed"]);

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
    if (key !== "loc" && key !== "start" && key !== "end") visit(child, onNode);
  }
}

export function validateWidgetSource(source: string): WidgetValidation {
  const issues = new Set<string>();
  const checks: WidgetValidation["checks"] = [];

  if (new TextEncoder().encode(source).length > 25_000) issues.add("Source exceeds the 25 KB limit.");

  let ast: ReturnType<typeof parse> | undefined;
  try {
    ast = parse(source, { sourceType: "module", plugins: ["jsx", "typescript"] });
    checks.push({ name: "Syntax", passed: true, detail: "Valid TSX module" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown parse error";
    issues.add(`Invalid TSX: ${detail}`);
    checks.push({ name: "Syntax", passed: false, detail });
  }

  if (ast) {
    visit(ast, (node) => {
      if (node.type === "ImportDeclaration") {
        const sourceValue = (node.source as AstNode | undefined)?.value;
        if (typeof sourceValue !== "string" || !ALLOWED_IMPORTS.has(sourceValue)) {
          issues.add(`Import '${String(sourceValue)}' is not allowed.`);
        }
      }
      if (node.type === "ImportExpression") issues.add("Dynamic imports are not allowed.");
      if (node.type === "Identifier" && BANNED_IDENTIFIERS.has(String(node.name))) {
        issues.add(`Browser or execution API '${String(node.name)}' is not allowed.`);
      }
      if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
        const path = memberPath(node);
        if (["window.parent", "window.top", "window.opener", "navigator.sendBeacon"].includes(path)) {
          issues.add(`Parent or network API '${path}' is not allowed.`);
        }
      }
      if (node.type === "JSXAttribute" && memberPath(node.name as AstNode) === "dangerouslySetInnerHTML") {
        issues.add("Unsafe HTML injection is not allowed.");
      }
      if (node.type === "JSXOpeningElement") {
        const tag = memberPath((node.name ?? {}) as AstNode).toLowerCase();
        if (BANNED_JSX.has(tag)) issues.add(`<${tag}> elements are not allowed.`);
      }
    });
  }

  const policyPassed = issues.size === 0;
  checks.push({
    name: "Policy scan",
    passed: policyPassed,
    detail: policyPassed ? "Imports, DOM access, and execution APIs are within policy" : `${issues.size} policy issue(s)`,
  });
  checks.push({
    name: "Source size",
    passed: new TextEncoder().encode(source).length <= 25_000,
    detail: `${new TextEncoder().encode(source).length.toLocaleString()} bytes`,
  });

  return { passed: issues.size === 0, checks, issues: [...issues] };
}

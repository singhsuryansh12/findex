export type WorkspaceValidationCode =
  | "WORKSPACE_POLICY_FAILED"
  | "WORKSPACE_TYPECHECK_FAILED"
  | "WORKSPACE_BUNDLE_FAILED"
  | "WORKSPACE_TEST_FAILED"
  | "WORKSPACE_SEMANTIC_FAILED"
  | "WORKSPACE_VALIDATION_TIMEOUT"
  | "WORKSPACE_PLATFORM_FAILED"
  | "WORKSPACE_VALIDATION_FAILED";

export type WorkspaceValidationFailure = {
  code: WorkspaceValidationCode;
  diagnostics: string[];
  actionable: boolean;
  platformTransient: boolean;
};

const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /\b(?:OPENAI_API_KEY|DEMO_SESSION_SECRET|VERCEL_OIDC_TOKEN)\s*[=:]\s*\S+/gi,
];
const actionablePattern = /\bTS\d{4}\b|\bsrc\/[\w./-]+\.(?:ts|tsx|css)(?:\(\d+[, :]\d+\)|:\d+(?::\d+)?)|\berror:\s+|\bexpected \d+ arguments?\b/i;
const transientPattern = /\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)\b|sandbox.*(?:timed out|unavailable|connection|platform)|network.*(?:unavailable|timeout)|\b(?:http|status|response)(?:\s+status|\s+code)?\s*[:=]?\s*(?:429|5\d\d)\b|\b(?:429|5\d\d)\s+(?:too many requests|internal server error|bad gateway|service unavailable|gateway timeout)\b/i;

function trimDiagnostic(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 24)).trimEnd()}\n… diagnostic truncated`;
}

export function sanitizeWorkspaceDiagnostic(value: string, options: { workspaceRoot?: string; maxChars?: number } = {}) {
  let sanitized = value.replace(ansiPattern, "").replaceAll("\r\n", "\n");
  if (options.workspaceRoot) {
    if (options.workspaceRoot.startsWith("/var/")) sanitized = sanitized.replaceAll(`/private${options.workspaceRoot}`, "<workspace>");
    sanitized = sanitized.replaceAll(options.workspaceRoot, "<workspace>");
  }
  sanitized = sanitized.replace(/(?:\/private)?\/var\/folders\/[^\s:]+\/findex-workspace-[^\s:]+/g, "<workspace>");
  sanitized = sanitized.replace(/\/tmp\/findex-workspace-[^\s:]+/g, "<workspace>");
  for (const pattern of secretPatterns) sanitized = sanitized.replace(pattern, "[REDACTED]");
  sanitized = sanitized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line.trim() || (index > 0 && lines[index - 1]?.trim()))
    .join("\n")
    .trim();
  return trimDiagnostic(sanitized, options.maxChars ?? 12_000);
}

export function hasActionableWorkspaceDiagnostics(diagnostics: string[]) {
  return diagnostics.some((diagnostic) => actionablePattern.test(diagnostic));
}

export function canRepairWorkspaceValidation(failure: WorkspaceValidationFailure) {
  return failure.actionable && !failure.platformTransient;
}

export class WorkspaceValidationError extends Error {
  readonly code: WorkspaceValidationCode;
  readonly diagnostics: string[];
  readonly actionable: boolean;
  readonly platformTransient: boolean;

  constructor(failure: WorkspaceValidationFailure, message = "Workspace validation failed.") {
    super(`${message}\n${failure.diagnostics.join("\n")}`.trim());
    this.name = "WorkspaceValidationError";
    this.code = failure.code;
    this.diagnostics = failure.diagnostics;
    this.actionable = failure.actionable;
    this.platformTransient = failure.platformTransient;
  }
}

export function validationFailureFrom(error: unknown): WorkspaceValidationFailure {
  if (error instanceof WorkspaceValidationError) {
    return {
      code: error.code,
      diagnostics: error.diagnostics,
      actionable: error.actionable,
      platformTransient: error.platformTransient,
    };
  }

  const rawMessage = error instanceof Error ? error.message : "Workspace validation failed.";
  const message = sanitizeWorkspaceDiagnostic(rawMessage, { maxChars: 12_000 }) || "Workspace validation failed.";
  const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
  const platformTransient = aborted || transientPattern.test(message);
  return {
    code: aborted ? "WORKSPACE_VALIDATION_TIMEOUT" : platformTransient ? "WORKSPACE_PLATFORM_FAILED" : "WORKSPACE_VALIDATION_FAILED",
    diagnostics: [message],
    actionable: !platformTransient && hasActionableWorkspaceDiagnostics([message]),
    platformTransient,
  };
}

function extractHostContractDiagnostics(raw: string) {
  const marker = "Workspace quality contract failed.";
  const start = raw.indexOf(marker);
  if (start >= 0) {
    const rest = raw.slice(start + marker.length);
    const endMatch = rest.search(/\n\s*at\s+\S+|\nCall log:|\n\s*\d+\)\s/);
    const body = (endMatch >= 0 ? rest.slice(0, endMatch) : rest)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    return body ? `${marker}\n${body}` : marker;
  }
  const focused = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /Workspace quality|Missing visible h1|Missing controls|Missing outputs|WCAG |accessible label|must initialize|changing the control|chart must|Live status|required state|off-step value|percentage maximum|numeric control must|Error: expect\(|Console\/page errors|Body text preview|Root HTML preview/i.test(line));
  if (focused.length) return [...new Set(focused)].slice(0, 40).join("\n");
  return null;
}

export function commandValidationFailure(options: {
  script: "typecheck" | "bundle" | "test";
  error: unknown;
  workspaceRoot?: string;
}): WorkspaceValidationFailure {
  const commandError = options.error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
  const output = [commandError?.stdout, commandError?.stderr]
    .map((part) => typeof part === "string" ? part : part?.toString("utf8"))
    .filter((part): part is string => Boolean(part?.trim()));
  const fallback = commandError instanceof Error ? commandError.message : `npm run ${options.script} failed.`;
  const raw = output.length ? output.join("\n") : fallback;
  const focused = options.script === "test" ? extractHostContractDiagnostics(raw) : null;
  const diagnostic = sanitizeWorkspaceDiagnostic(focused ?? raw, {
    workspaceRoot: options.workspaceRoot,
    maxChars: focused ? 6_000 : 12_000,
  }) || `npm run ${options.script} failed without compiler or test diagnostics.`;
  const missingToolchain = /tsc:\s*command not found|not found: tsc|Cannot find module ['"]?typescript|\[externals\].*typescript\/lib\/tsc|TS2688:\s*Cannot find type definition file for ['"](?:node|vitest\/globals)['"]|TS7016:\s*Could not find a declaration file for module ['"]react(?:\/jsx-runtime)?['"]|Could not find a declaration file for module ['"]react(?:-dom)?['"]|JSX element implicitly has type 'any' because no interface 'JSX\.IntrinsicElements' exists|Try `npm i --save-dev @types\/react`/i.test(diagnostic);
  const platformTransient = missingToolchain
    || transientPattern.test(diagnostic)
    || (commandError instanceof Error && (commandError.name === "AbortError" || commandError.name === "TimeoutError"));
  const code = options.script === "typecheck"
    ? "WORKSPACE_TYPECHECK_FAILED"
    : options.script === "bundle"
      ? "WORKSPACE_BUNDLE_FAILED"
      : "WORKSPACE_TEST_FAILED";
  return {
    code: platformTransient ? "WORKSPACE_PLATFORM_FAILED" : code,
    diagnostics: [diagnostic],
    // Playwright/Vitest host-contract failures are always repairable when they
    // produce diagnostics; their wording often lacks TypeScript path markers.
    actionable: !platformTransient && (options.script === "test" || hasActionableWorkspaceDiagnostics([diagnostic])),
    platformTransient,
  };
}

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
  const diagnostic = sanitizeWorkspaceDiagnostic(output.length ? output.join("\n") : fallback, {
    workspaceRoot: options.workspaceRoot,
    maxChars: 12_000,
  }) || `npm run ${options.script} failed without compiler or test diagnostics.`;
  const platformTransient = transientPattern.test(diagnostic)
    || (commandError instanceof Error && (commandError.name === "AbortError" || commandError.name === "TimeoutError"));
  const code = options.script === "typecheck"
    ? "WORKSPACE_TYPECHECK_FAILED"
    : options.script === "bundle"
      ? "WORKSPACE_BUNDLE_FAILED"
      : "WORKSPACE_TEST_FAILED";
  return {
    code: platformTransient ? "WORKSPACE_PLATFORM_FAILED" : code,
    diagnostics: [diagnostic],
    actionable: !platformTransient && hasActionableWorkspaceDiagnostics([diagnostic]),
    platformTransient,
  };
}

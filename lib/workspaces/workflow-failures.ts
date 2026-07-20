import { WorkspaceModelError } from "./openai-response";

const GENERIC_FAILURE = "Findex couldn't finish this workspace; nothing was published.";

function messageFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Error && value.message.trim()) return value.message;
  if (value && typeof value === "object") {
    const record = value as { message?: unknown; error?: unknown; cause?: unknown };
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (typeof record.error === "string" && record.error.trim()) return record.error;
  }
  return null;
}

/** Walk wrapped Workflow / provider error shapes for a user-safe Findex message. */
export function safeFailureMessage(error: unknown): string {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null && !seen.has(current); depth += 1) {
    seen.add(current);
    if (current instanceof WorkspaceModelError) {
      const message = current.message.startsWith("Findex") ? current.message : userMessageForModelCode(current.code);
      return message.slice(0, 600);
    }
    const text = messageFromUnknown(current);
    if (text) {
      const findexIndex = text.indexOf("Findex");
      if (findexIndex >= 0) {
        const sliced = text.slice(findexIndex).split("\n")[0]?.trim() ?? "";
        if (sliced.startsWith("Findex")) return sliced.slice(0, 600);
      }
      if (text.startsWith("Findex")) return text.slice(0, 600);
    }
    if (current instanceof Error && "cause" in current) {
      current = current.cause;
      continue;
    }
    if (current && typeof current === "object" && "cause" in current) {
      current = (current as { cause: unknown }).cause;
      continue;
    }
    if (current && typeof current === "object" && "error" in current) {
      current = (current as { error: unknown }).error;
      continue;
    }
    break;
  }
  return GENERIC_FAILURE;
}

export function userMessageForModelCode(code: WorkspaceModelError["code"]): string {
  switch (code) {
    case "PLAN_TIMEOUT":
      return "Findex timed out while building the workspace; nothing was published.";
    case "PLAN_TOKEN_LIMIT":
      return "Findex ran out of response capacity while building the workspace; nothing was published.";
    case "PLAN_REFUSED":
      return "Findex couldn't build that workspace safely; nothing was published.";
    case "PLAN_INVALID":
      return "Findex couldn't finish the workspace source pass; nothing was published.";
    case "MODEL_TRANSIENT":
      return "Findex hit a temporary model service error while building; nothing was published. You can retry.";
    case "MODEL_FAILED":
      return "Findex couldn't complete the workspace build; nothing was published.";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

export function buildFailureMessage(error: unknown): string {
  if (error instanceof WorkspaceModelError) {
    return (error.message.startsWith("Findex") ? error.message : userMessageForModelCode(error.code)).slice(0, 600);
  }
  return safeFailureMessage(error);
}

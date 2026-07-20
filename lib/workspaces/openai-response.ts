import type { ParsedResponse, Response } from "openai/resources/responses/responses";
import type { FindexModel } from "./model-policy";
import type { ModelStageTrace, ReasoningEffort, WorkspaceTokenUsage } from "./contracts";

export type WorkspaceModelErrorCode =
  | "PLAN_TOKEN_LIMIT"
  | "PLAN_REFUSED"
  | "PLAN_TIMEOUT"
  | "PLAN_INVALID"
  | "MODEL_TRANSIENT"
  | "MODEL_FAILED";

export class WorkspaceModelError extends Error {
  constructor(
    public readonly code: WorkspaceModelErrorCode,
    message: string,
    public readonly metadata: {
      responseId?: string;
      responseStatus?: string;
      incompleteReason?: string;
      usage?: WorkspaceTokenUsage;
      retryable?: boolean;
      providerErrorClass?: string;
      providerStatus?: number;
      providerCode?: string;
      providerRequestId?: string;
    } = {},
  ) {
    super(message);
    this.name = "WorkspaceModelError";
  }
}

export function usageOf(response: { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null }): WorkspaceTokenUsage {
  return {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  };
}

function hasRefusal(response: { output?: Array<{ type: string; content?: Array<{ type: string }> }> }) {
  return response.output?.some((item) => item.type === "message" && item.content?.some((content) => content.type === "refusal")) ?? false;
}

export function requireParsedResponse<T>(response: ParsedResponse<T>, label: "plan" | "assessment" | "review"): T {
  const metadata = {
    responseId: response.id,
    responseStatus: response.status,
    incompleteReason: response.incomplete_details?.reason,
    usage: usageOf(response),
  };
  if (hasRefusal(response) || response.incomplete_details?.reason === "content_filter") {
    throw new WorkspaceModelError("PLAN_REFUSED", `Findex could not complete the ${label} because the request was declined.`, metadata);
  }
  if (response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens") {
    throw new WorkspaceModelError("PLAN_TOKEN_LIMIT", `Findex ran out of response capacity while preparing the ${label}.`, { ...metadata, retryable: true });
  }
  if (response.status === "completed" && response.output_parsed) return response.output_parsed;
  throw new WorkspaceModelError("PLAN_INVALID", `Findex did not return a valid ${label}.`, metadata);
}

export function requireCompletedResponse(response: Response, label: string) {
  const metadata = {
    responseId: response.id,
    responseStatus: response.status,
    incompleteReason: response.incomplete_details?.reason,
    usage: usageOf(response),
  };
  if (hasRefusal(response) || response.incomplete_details?.reason === "content_filter") {
    throw new WorkspaceModelError("PLAN_REFUSED", `Findex could not complete ${label} because the request was declined.`, metadata);
  }
  if (response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens") {
    throw new WorkspaceModelError("PLAN_TOKEN_LIMIT", `Findex ran out of response capacity while completing ${label}.`, { ...metadata, retryable: true });
  }
  if (response.status !== "completed") {
    throw new WorkspaceModelError("MODEL_FAILED", `Findex could not complete ${label}.`, metadata);
  }
}

export function normalizeModelError(error: unknown, label = "request") {
  if (error instanceof WorkspaceModelError) return error;
  const provider = typeof error === "object" && error ? error as {
    name?: unknown;
    status?: unknown;
    code?: unknown;
    requestID?: unknown;
  } : {};
  const providerErrorClass = error instanceof Error
    ? (error.name && error.name !== "Error" ? error.name : error.constructor.name)
    : undefined;
  const status = Number(provider.status);
  const metadata = {
    providerErrorClass,
    providerStatus: Number.isFinite(status) && status > 0 ? status : undefined,
    providerCode: typeof provider.code === "string" ? provider.code.slice(0, 120) : undefined,
    providerRequestId: typeof provider.requestID === "string" ? provider.requestID.slice(0, 200) : undefined,
  };
  if (["TimeoutError", "AbortError", "APIConnectionTimeoutError", "APIUserAbortError"].includes(providerErrorClass ?? "")) {
    return new WorkspaceModelError("PLAN_TIMEOUT", `Findex timed out while preparing the ${label}.`, metadata);
  }
  if (providerErrorClass === "LengthFinishReasonError") {
    return new WorkspaceModelError("PLAN_TOKEN_LIMIT", `Findex ran out of response capacity while preparing the ${label}.`, { ...metadata, retryable: true });
  }
  if (providerErrorClass === "ContentFilterFinishReasonError") {
    return new WorkspaceModelError("PLAN_REFUSED", `Findex could not complete the ${label} because the request was declined.`, metadata);
  }
  if (providerErrorClass === "ZodError" || providerErrorClass === "SyntaxError") {
    return new WorkspaceModelError("PLAN_INVALID", `Findex did not return a valid ${label}.`, metadata);
  }
  if (providerErrorClass === "APIConnectionError") {
    return new WorkspaceModelError("MODEL_TRANSIENT", `Findex encountered a temporary model service error while preparing the ${label}.`, { ...metadata, retryable: true });
  }
  if ([408, 409, 429].includes(status) || status >= 500) {
    return new WorkspaceModelError("MODEL_TRANSIENT", `Findex encountered a temporary model service error while preparing the ${label}.`, { ...metadata, retryable: true });
  }
  return new WorkspaceModelError("MODEL_FAILED", `Findex could not complete the ${label}.`, metadata);
}

export function logModelFailureContext(requestId: string, stage: ModelStageTrace["stage"], error: WorkspaceModelError) {
  console.warn(JSON.stringify({
    event: "findex_model_failure",
    requestId,
    stage,
    code: error.code,
    messagePreview: error.message.replace(/\s+/g, " ").slice(0, 240),
    providerErrorClass: error.metadata.providerErrorClass,
    providerStatus: error.metadata.providerStatus,
    providerCode: error.metadata.providerCode,
    providerRequestId: error.metadata.providerRequestId,
  }));
}

export function traceFor(options: {
  stage: ModelStageTrace["stage"];
  model: FindexModel;
  effort: ReasoningEffort;
  attempt: number;
  durationMs: number;
  usage?: WorkspaceTokenUsage;
  outcome: ModelStageTrace["outcome"];
  responseId?: string;
  incompleteReason?: string;
}): ModelStageTrace {
  return {
    ...options,
    tokenUsage: options.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
}

export function logModelTrace(requestId: string, trace: ModelStageTrace) {
  console.info(JSON.stringify({
    event: "findex_model_stage",
    requestId,
    stage: trace.stage,
    model: trace.model,
    effort: trace.effort,
    attempt: trace.attempt,
    durationMs: trace.durationMs,
    usage: trace.tokenUsage,
    outcome: trace.outcome,
    responseId: trace.responseId,
    incompleteReason: trace.incompleteReason,
  }));
}

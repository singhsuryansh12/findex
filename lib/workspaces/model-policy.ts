import type { BuildComplexityLevel, ReasoningEffort } from "./contracts";

export const FINDEX_MODELS = {
  terra: "gpt-5.6-terra",
  sol: "gpt-5.6-sol",
} as const;

export type FindexModel = (typeof FINDEX_MODELS)[keyof typeof FINDEX_MODELS];

export const stageDeadlines = {
  financialAnswerMs: 60_000,
  assessmentMs: 30_000,
  planningAttemptMs: 90_000,
  brainRequestMs: 210_000,
  simpleBuildMs: 180_000,
  standardBuildMs: 240_000,
  complexBuildMs: 240_000,
  validationMs: 210_000,
  reviewMs: 90_000,
  workflowMs: 20 * 60_000,
} as const;

export type ModelPolicy = {
  model: FindexModel;
  effort: ReasoningEffort;
  maxOutputTokens: number;
};

export const assessmentPolicy: ModelPolicy = {
  model: FINDEX_MODELS.terra,
  effort: "low",
  maxOutputTokens: 800,
};

export function planningPolicy(level: BuildComplexityLevel, attempt = 1, semanticRepair = false): ModelPolicy {
  if (level === "complex") {
    return {
      model: FINDEX_MODELS.sol,
      effort: "medium",
      maxOutputTokens: attempt > 1 ? 24_000 : 16_000,
    };
  }
  if (semanticRepair) {
    return { model: FINDEX_MODELS.sol, effort: "medium", maxOutputTokens: 16_000 };
  }
  return {
    model: FINDEX_MODELS.terra,
    effort: "medium",
    maxOutputTokens: attempt > 1 ? 24_000 : 12_000,
  };
}

export type PlanningFailureCode = "PLAN_TOKEN_LIMIT" | "PLAN_REFUSED" | "PLAN_TIMEOUT" | "PLAN_INVALID" | "MODEL_TRANSIENT" | "MODEL_FAILED";

export function retryPlanningPolicy(level: BuildComplexityLevel, code: PlanningFailureCode): ModelPolicy | null {
  if (code === "PLAN_TOKEN_LIMIT") return planningPolicy(level, 2);
  if (code === "MODEL_TRANSIENT") return planningPolicy(level, 1);
  if (code === "PLAN_INVALID" && level !== "complex") return planningPolicy(level, 2, true);
  return null;
}

export function buildPolicy(level: BuildComplexityLevel, repair = false): ModelPolicy {
  if (level === "complex") {
    return {
      model: FINDEX_MODELS.sol,
      effort: repair ? "high" : "medium",
      maxOutputTokens: 32_000,
    };
  }
  return {
    model: repair ? FINDEX_MODELS.sol : FINDEX_MODELS.terra,
    effort: "medium",
    maxOutputTokens: 32_000,
  };
}

export function reviewPolicy(level: BuildComplexityLevel): ModelPolicy {
  return {
    model: FINDEX_MODELS.sol,
    effort: level === "complex" ? "medium" : "low",
    maxOutputTokens: 12_000,
  };
}

export function buildDeadline(level: BuildComplexityLevel) {
  if (level === "complex") return stageDeadlines.complexBuildMs;
  return level === "standard" ? stageDeadlines.standardBuildMs : stageDeadlines.simpleBuildMs;
}

export type WorkspaceFailureKind = "source_validation" | "semantic_review" | "provider_or_platform";

export function shouldRepairWorkspaceFailure(kind: WorkspaceFailureKind) {
  return kind === "source_validation" || kind === "semantic_review";
}

export function independentSignal(timeoutMs: number, parent?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

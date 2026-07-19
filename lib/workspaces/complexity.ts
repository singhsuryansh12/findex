import type {
  ActiveWorkspaceContext,
  BuildComplexityAssessment,
  BuildComplexityLevel,
  ReasoningEffort,
  WorkspaceBuildPlan,
} from "./contracts";

const rank: Record<BuildComplexityLevel, number> = { simple: 0, standard: 1, complex: 2 };
const levels: BuildComplexityLevel[] = ["simple", "standard", "complex"];

export const complexityPolicy: Record<BuildComplexityLevel, {
  effort: ReasoningEffort;
  budgetMs: number;
  repairAttempts: number;
}> = {
  simple: { effort: "low", budgetMs: 90_000, repairAttempts: 1 },
  standard: { effort: "medium", budgetMs: 160_000, repairAttempts: 2 },
  complex: { effort: "high", budgetMs: 240_000, repairAttempts: 2 },
};

export function higherComplexity(first: BuildComplexityLevel, second: BuildComplexityLevel) {
  return levels[Math.max(rank[first], rank[second])];
}

export function nextEffort(effort: ReasoningEffort): ReasoningEffort {
  if (effort === "low") return "medium";
  return "high";
}

export function enforceComplexityFloor(
  assessment: BuildComplexityAssessment,
  plan?: WorkspaceBuildPlan,
): BuildComplexityAssessment {
  if (!plan) return assessment;
  const flags = new Set(assessment.riskFlags);
  let floor: BuildComplexityLevel = "simple";

  if (plan.capabilities.some((item) => item.startsWith("ledger.")) || plan.capabilities.includes("file.export")) {
    floor = higherComplexity(floor, "standard");
  }
  if (plan.layout.length > 1 || plan.interactions.length > 4 || plan.inputs.length > 6) {
    floor = higherComplexity(floor, "standard");
    flags.add("multi_view");
  }
  const planText = [plan.title, plan.goal, ...plan.dataNeeds, ...plan.acceptanceCriteria].join(" ").toLowerCase();
  if (/\b(tax|withholding|capital gains?|portfolio|monte carlo|cryptocurrency|crypto allocation)\b/.test(planText)) {
    floor = "complex";
    flags.add("sensitive_math");
  }
  if (/\b(security|secret|credential|trading|money movement)\b/.test(planText)) {
    floor = "complex";
    flags.add("security");
  }
  if (plan.layout.length > 2 || (plan.layout.length > 1 && /\b(view|tab|screen|dashboard)\b/.test(planText))) {
    floor = "complex";
    flags.add("multi_view");
  }
  if (plan.persistence.enabled || plan.capabilities.includes("workspace.state")) {
    floor = "complex";
    flags.add("persistence");
  }
  if (plan.capabilities.some((item) => item.startsWith("market."))) {
    floor = "complex";
    flags.add("live_data");
  }
  if (plan.capabilities.includes("research.webSearch")) {
    floor = "complex";
    flags.add("live_data");
  }
  if (plan.capabilities.includes("ai.analyze")) {
    floor = "complex";
    flags.add("runtime_ai");
  }

  const level = higherComplexity(assessment.level, floor);
  return {
    level,
    riskFlags: [...flags].slice(0, 8),
    rationale: level === assessment.level
      ? assessment.rationale
      : `${assessment.rationale} Host policy raised the request to ${level} because of its declared capabilities or state requirements.`,
  };
}

export function normalizePlanForActiveWorkspace(
  plan: WorkspaceBuildPlan,
  active: Pick<ActiveWorkspaceContext, "manifest"> | null,
): WorkspaceBuildPlan {
  if (plan.intent !== "create" && plan.intent !== "revise") return plan;
  const normalized: WorkspaceBuildPlan = {
    ...plan,
    persistence: { ...plan.persistence },
    assumptions: [...plan.assumptions],
    capabilities: [...new Set(plan.capabilities)],
    disclosures: [...plan.disclosures],
  };
  if (normalized.persistence.enabled && !normalized.capabilities.includes("workspace.state")) normalized.capabilities.push("workspace.state");
  if (!normalized.persistence.enabled) normalized.capabilities = normalized.capabilities.filter((capability) => capability !== "workspace.state");
  const exportRequested = /\b(?:csv|json)\s+export\b|\bexport\s+(?:csv|json|data)\b/i.test([
    normalized.goal,
    ...normalized.interactions,
    ...normalized.acceptanceCriteria,
  ].join(" "));
  if (exportRequested && !normalized.capabilities.includes("file.export")) normalized.capabilities.push("file.export");
  if (!normalized.disclosures.some((item) => /not financial advice|educational/i.test(item))) {
    normalized.disclosures = [
      ...normalized.disclosures.slice(0, 7),
      "Educational information only; not financial advice.",
    ];
  }
  normalized.disclosures = normalized.disclosures.slice(0, 8);
  normalized.intent = active ? "revise" : "create";
  if (active && normalized.persistence.stateSchemaVersion !== active.manifest.stateSchemaVersion) {
    normalized.persistence.stateSchemaVersion = active.manifest.stateSchemaVersion;
    normalized.assumptions = [
      ...normalized.assumptions,
      `Persisted state remains compatible with schema version ${active.manifest.stateSchemaVersion}.`,
    ].slice(0, 12);
  }
  return normalized;
}

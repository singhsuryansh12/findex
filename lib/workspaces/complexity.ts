import type {
  ActiveWorkspaceContext,
  BuildComplexityAssessment,
  BuildComplexityLevel,
  ReasoningEffort,
  WorkspaceBuildPlan,
} from "./contracts";

const rank: Record<BuildComplexityLevel, number> = { simple: 0, standard: 1, complex: 2 };
const levels: BuildComplexityLevel[] = ["simple", "standard", "complex"];
const negatedScopePrefix = /\b(?:no|not|without|never|exclude|excluding|do not|does not|must not|contains no)\b[^.!?;]{0,100}$/i;

function hasAffirmativeScopeRisk(text: string, pattern: RegExp) {
  const matcher = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  for (const match of text.matchAll(matcher)) {
    const prefix = text.slice(Math.max(0, (match.index ?? 0) - 100), match.index);
    if (!negatedScopePrefix.test(prefix)) return true;
  }
  return false;
}

export const complexityPolicy: Record<BuildComplexityLevel, {
  effort: ReasoningEffort;
  budgetMs: number;
  repairAttempts: number;
}> = {
  simple: { effort: "medium", budgetMs: 180_000, repairAttempts: 1 },
  standard: { effort: "medium", budgetMs: 240_000, repairAttempts: 1 },
  complex: { effort: "medium", budgetMs: 240_000, repairAttempts: 1 },
};

export function higherComplexity(first: BuildComplexityLevel, second: BuildComplexityLevel) {
  return levels[Math.max(rank[first], rank[second])];
}

export function nextEffort(effort: ReasoningEffort): ReasoningEffort {
  if (effort === "low") return "medium";
  return "high";
}

export function calibrateInitialComplexity(
  assessment: BuildComplexityAssessment,
  prompt: string,
  hasActiveWorkspace: boolean,
): BuildComplexityAssessment {
  if (hasActiveWorkspace || assessment.level !== "complex") return assessment;
  const ordinaryFire = /\b(?:fire|financial independence|retirement)\b/i.test(prompt)
    && /\b(?:calculator|planner|planning|plan)\b/i.test(prompt);
  const explicitlyComplex = /\b(?:tax|withholding|capital gains?|monte carlo|live (?:market|research|data)|web research|runtime ai|cryptocurrency|crypto|portfolio (?:allocation|optimization|rebalancing)|multiple (?:views?|tabs?|screens?)|multi-page|trading|money movement|security|credentials?)\b/i.test(prompt);
  if (!ordinaryFire || explicitlyComplex) return assessment;
  return {
    level: "standard",
    riskFlags: assessment.riskFlags.filter((flag) => !["live_data", "runtime_ai", "multi_view", "sensitive_math", "security"].includes(flag)),
    rationale: "Findex calibrated this ordinary FIRE or retirement calculator to the standard build policy; no complex capability was requested.",
  };
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
  if (plan.persistence.enabled || plan.capabilities.includes("workspace.state")) {
    floor = higherComplexity(floor, "standard");
    flags.add("persistence");
  }
  if (plan.layout.length > 1 || plan.interactions.length > 4 || plan.inputs.length > 6) {
    floor = higherComplexity(floor, "standard");
    flags.add("rich_interaction");
  }
  // Complexity must come from positive implementation scope. Acceptance
  // criteria and disclosures often state forbidden behavior in the negative
  // (for example, "contains no trading or money movement") and must never be
  // interpreted as requested capabilities.
  const scopeText = [plan.title, plan.goal, ...plan.dataNeeds, ...plan.interactions].join(" ").toLowerCase();
  if (hasAffirmativeScopeRisk(scopeText, /\b(tax|withholding|capital gains?|monte carlo|cryptocurrency|crypto allocation|portfolio (?:allocation|optimization|rebalancing))\b/)) {
    floor = "complex";
    flags.add("sensitive_math");
  }
  if (hasAffirmativeScopeRisk(scopeText, /\b(security|secret|credential|trading|money movement)\b/)) {
    floor = "complex";
    flags.add("security");
  }
  if (/\b(?:multiple|separate|coordinated|multi-page) (?:views?|tabs?|screens?|dashboards?)\b|\b(?:tabs?|screens?) with (?:independent|separate) state\b/.test(scopeText)) {
    floor = "complex";
    flags.add("multi_view");
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
  prompt = "",
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
  const planScope = `${normalized.title} ${normalized.goal}`;
  const ordinaryFire = /\b(?:fire|financial independence|retirement)\b/i.test(planScope)
    && /\b(?:calculator|planner|planning|plan)\b/i.test(planScope);
  const explicitZeroSpending = /\b(?:zero|no)\s+(?:annual\s+)?(?:retirement\s+)?spending\b/i.test(prompt);
  let normalizedIllustrativeSpending = false;
  if (ordinaryFire && !explicitZeroSpending) {
    normalized.inputs = normalized.inputs.map((input) => {
      const isAnnualSpending = input.type === "currency" && /\b(?:annual|yearly).*\bspend|\bretirement spending\b/i.test(`${input.label} ${input.description}`);
      if (!isAnnualSpending || Number(input.defaultValue) > 0) return input;
      normalizedIllustrativeSpending = true;
      return { ...input, defaultValue: "60000" };
    });
  }
  if (normalizedIllustrativeSpending) {
    normalized.assumptions = [
      ...normalized.assumptions,
      "Illustrative annual retirement spending starts at 60,000 in the selected currency because no spending amount was supplied; edit it to match your scenario.",
    ].slice(0, 12);
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

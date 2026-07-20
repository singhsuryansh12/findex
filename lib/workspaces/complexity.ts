import type {
  ActiveWorkspaceContext,
  BuildComplexityAssessment,
  BuildComplexityLevel,
  ReasoningEffort,
  WorkspaceBuildPlan,
} from "./contracts";
import { applyLedgerGrounding } from "./grounding";

type PlanInput = WorkspaceBuildPlan["inputs"][number];
type NumericBounds = { min: string; max: string; step: string };

const contradictoryConstraintProse = /\b(?:any non-negative|any amount|greater than (?:zero|0)|more than zero|decimals? like|fractional (?:ages?|years?)|30\.25|allow(?:s|ed)?\s+decimals?|arbitrary increments?|increments? of (?:one|1)\b|step of 0\.01)\b/i;

function isFiniteBound(value: string | null | undefined) {
  if (value == null || value.trim() === "") return false;
  const numeric = Number(value);
  return Number.isFinite(numeric);
}

function isAnnualSpendingInput(input: PlanInput) {
  return input.type === "currency"
    && /\b(?:annual|yearly).*\bspend|\bretirement spending\b/i.test(`${input.label} ${input.description}`);
}

function classifyNumericInput(input: PlanInput): "age_years" | "horizon_years" | "currency_spend" | "currency" | "withdrawal_rate" | "percentage" | "number" | null {
  const text = `${input.id} ${input.label} ${input.description}`.toLowerCase();
  if (input.type === "percentage") {
    if (/\bwithdraw/.test(text)) return "withdrawal_rate";
    return "percentage";
  }
  if (input.type === "currency") return isAnnualSpendingInput(input) ? "currency_spend" : "currency";
  if (input.type !== "number") return null;
  if (/\bage\b/.test(text)) return "age_years";
  if (/\b(?:horizon|projection|planning)\b/.test(text) || /\byears?\b/.test(text)) return "horizon_years";
  return "number";
}

function hostBoundsFor(input: PlanInput, ordinaryFire: boolean): NumericBounds | null {
  const kind = classifyNumericInput(input);
  if (!kind) return null;
  switch (kind) {
    case "age_years":
      return { min: "18", max: "100", step: "1" };
    case "horizon_years":
      return { min: "1", max: ordinaryFire ? "80" : "100", step: "1" };
    case "currency_spend":
      return ordinaryFire
        ? { min: "1000", max: "10000000", step: "1000" }
        : { min: "0", max: "10000000", step: "100" };
    case "currency":
      return ordinaryFire
        ? { min: "0", max: "100000000", step: "1000" }
        : { min: "0", max: "100000000", step: "100" };
    case "withdrawal_rate":
      // Zero withdrawal makes FIRE target undefined (division by zero); keep it invalid.
      return { min: "0.1", max: "20", step: "0.1" };
    case "percentage":
      return { min: "0", max: "100", step: "0.1" };
    case "number":
      return { min: "0", max: "1000000", step: "1" };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function hasCompleteBounds(input: PlanInput) {
  if (!isFiniteBound(input.min) || !isFiniteBound(input.max) || !isFiniteBound(input.step)) return false;
  const min = Number(input.min);
  const max = Number(input.max);
  const step = Number(input.step);
  return step > 0 && max > min;
}

/** Host-owned numeric domains so planner prose, builder code, and review stay aligned. */
export function normalizePlanInputConstraints(input: PlanInput, ordinaryFire: boolean): PlanInput {
  if (!["number", "currency", "percentage"].includes(input.type)) {
    return { ...input, min: null, max: null, step: null };
  }
  const host = hostBoundsFor(input, ordinaryFire);
  if (!host) return input;
  // Ordinary FIRE plans always use host domains — planner acceptance prose often drifts.
  if (ordinaryFire || !hasCompleteBounds(input)) {
    return { ...input, min: host.min, max: host.max, step: host.step };
  }
  return {
    ...input,
    min: String(input.min),
    max: String(input.max),
    step: String(input.step),
  };
}

export function sanitizeConstraintAcceptanceCriteria(criteria: string[], hasNumericInputs = true): string[] {
  const kept = criteria.filter((item) => !contradictoryConstraintProse.test(item));
  if (!hasNumericInputs) return kept.slice(0, 20);
  const constraintCriterion = "Every numeric, currency, and percentage input enforces its planned min, max, and step in both the control attributes and application validation (use scaled integer step checks so float noise is not a false failure).";
  if (!kept.some((item) => /planned min|min, max, and step/i.test(item))) {
    kept.push(constraintCriterion);
  }
  return kept.slice(0, 20);
}

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
  if (hasActiveWorkspace) return assessment;
  const explicitlyComplex = /\b(?:tax|withholding|capital gains?|monte carlo|live (?:market|research|data)|web research|runtime ai|cryptocurrency|crypto|portfolio (?:allocation|optimization|rebalancing)|multiple (?:views?|tabs?|screens?)|multi-page|trading|money movement|security|credentials?)\b/i.test(prompt);
  const ordinaryCalculator = /\b(?:calculator|planner|planning|plan|tool|projection|simulator|workspace)\b/i.test(prompt)
    || /\b(?:fire|financial independence|retirement|wealth|cash ?flow)\b/i.test(prompt);
  if (explicitlyComplex || !ordinaryCalculator) return assessment;
  if (assessment.level === "complex") {
    return {
      level: "simple",
      riskFlags: assessment.riskFlags.filter((flag) => !["live_data", "runtime_ai", "multi_view", "sensitive_math", "security"].includes(flag)),
      rationale: "Findex calibrated this ordinary calculator to the simple build policy; no complex capability was requested.",
    };
  }
  if (assessment.level === "standard") {
    return {
      level: "simple",
      riskFlags: assessment.riskFlags,
      rationale: "Findex calibrated this ordinary calculator to the simple build policy for a faster draft-first live build.",
    };
  }
  return assessment;
}

export function enforceComplexityFloor(
  assessment: BuildComplexityAssessment,
  plan?: WorkspaceBuildPlan,
): BuildComplexityAssessment {
  if (!plan) return assessment;
  const flags = new Set(assessment.riskFlags);
  let floor: BuildComplexityLevel = "simple";

  // Keep ordinary calculators on the simple draft-first path. Export and rich multi-view
  // layouts can raise to standard; only market/AI/tax/security scope reaches complex.
  if (plan.capabilities.includes("file.export")) {
    floor = higherComplexity(floor, "standard");
  }
  if (plan.layout.length > 1) {
    floor = higherComplexity(floor, "standard");
    flags.add("rich_interaction");
  }
  if (plan.persistence.enabled || plan.capabilities.includes("workspace.state")) {
    flags.add("persistence");
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
  normalized.inputs = normalized.inputs.map((input) => {
    let next = normalizePlanInputConstraints(input, ordinaryFire);
    if (ordinaryFire && !explicitZeroSpending && isAnnualSpendingInput(next) && !(Number(next.defaultValue) > 0)) {
      normalizedIllustrativeSpending = true;
      next = { ...next, defaultValue: "60000" };
    }
    return next;
  });
  if (normalizedIllustrativeSpending) {
    normalized.assumptions = [
      ...normalized.assumptions,
      "Illustrative annual retirement spending starts at 60,000 in the selected currency because no spending amount was supplied; edit it to match your scenario.",
    ].slice(0, 12);
  }
  const hasNumericInputs = normalized.inputs.some((input) => ["number", "currency", "percentage"].includes(input.type));
  normalized.acceptanceCriteria = sanitizeConstraintAcceptanceCriteria(normalized.acceptanceCriteria, hasNumericInputs);
  normalized.disclosures = normalized.disclosures.slice(0, 8);
  normalized.intent = active ? "revise" : "create";
  if (active && normalized.persistence.stateSchemaVersion !== active.manifest.stateSchemaVersion) {
    normalized.persistence.stateSchemaVersion = active.manifest.stateSchemaVersion;
    normalized.assumptions = [
      ...normalized.assumptions,
      `Persisted state remains compatible with schema version ${active.manifest.stateSchemaVersion}.`,
    ].slice(0, 12);
  }
  return applyLedgerGrounding(normalized, prompt);
}

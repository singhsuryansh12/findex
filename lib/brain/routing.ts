export type BrainIntent = "financial_question" | "workspace";

const workspaceNoun = /\b(calculator|workspace|tool|planner|tracker|dashboard|simulator|application|app|lab)\b/i;
const buildVerb = /\b(build|create|design|develop|generate)\b/i;
const revisionVerb = /\b(revise|edit|update|change|modify|add|remove|fix|repair)\b/i;
const questionOpening = /^(what|why|how|when|where|which|is|are|do|does|did|can|should|could|would)\b/i;

export function classifyBrainIntent(
  message: string,
  options: { hasActiveWorkspace: boolean; hasClarificationToken: boolean },
): BrainIntent {
  const normalized = message.trim();
  if (options.hasClarificationToken) return "workspace";
  if (buildVerb.test(normalized)) return "workspace";
  if (options.hasActiveWorkspace && revisionVerb.test(normalized)) return "workspace";
  if (workspaceNoun.test(normalized) && !questionOpening.test(normalized)) return "workspace";
  return "financial_question";
}

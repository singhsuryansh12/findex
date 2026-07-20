import type { CapabilityName, WorkspaceBuildPlan } from "./contracts";

const myMoneyPrompt = /\b(?:my|your|jordan(?:'s)?)\b.{0,40}\b(?:money|spend|spending|income|cash ?flow|budget|bills?|portfolio|wealth|net worth|savings|transactions?|afford)\b|\b(?:spend|spending|cash ?flow|portfolio|wealth|net worth)\b.{0,40}\b(?:my|your|jordan)\b/i;

const wealthLike = /\b(?:wealth|net worth|projection|invest|savings rate|systematic)\b/i;
const cashflowLike = /\b(?:cash ?flow|afford|bills?|subscriptions?|runway|surplus)\b/i;
const spendLike = /\b(?:spend|spending|where did .+ money|budget|categories)\b/i;
const portfolioLike = /\b(?:portfolio|allocation|holdings?|investments?)\b/i;

/** Detect prompts that should be grounded in the demo ledger. */
export function isMyMoneyBuildPrompt(prompt: string) {
  return myMoneyPrompt.test(prompt) || (
    /\b(?:build|create|make|workspace|tool|calculator|planner)\b/i.test(prompt)
    && (wealthLike.test(prompt) || cashflowLike.test(prompt) || spendLike.test(prompt) || portfolioLike.test(prompt))
    && /\b(?:my|your|personal|grounded|jordan)\b/i.test(prompt)
  );
}

export function defaultLedgerCapabilitiesForPrompt(prompt: string): CapabilityName[] {
  if (!isMyMoneyBuildPrompt(prompt) && !wealthLike.test(prompt) && !cashflowLike.test(prompt) && !spendLike.test(prompt) && !portfolioLike.test(prompt)) {
    return [];
  }
  // Hypothetical FIRE-only calculators stay input-driven unless the prompt asks for personal data.
  if (/\b(?:fire|financial independence|retirement)\b/i.test(prompt) && !isMyMoneyBuildPrompt(prompt)) {
    return [];
  }
  const grants = new Set<CapabilityName>();
  if (spendLike.test(prompt) || isMyMoneyBuildPrompt(prompt)) {
    grants.add("ledger.snapshot");
    grants.add("ledger.transactions");
  }
  if (cashflowLike.test(prompt) || wealthLike.test(prompt) || isMyMoneyBuildPrompt(prompt)) {
    grants.add("ledger.snapshot");
    grants.add("ledger.cashflow");
    grants.add("ledger.forecast");
    grants.add("ledger.recurring");
  }
  if (portfolioLike.test(prompt) || wealthLike.test(prompt)) {
    grants.add("ledger.snapshot");
    grants.add("ledger.portfolio");
  }
  if (!grants.size && isMyMoneyBuildPrompt(prompt)) {
    grants.add("ledger.snapshot");
    grants.add("ledger.cashflow");
    grants.add("ledger.portfolio");
  }
  return [...grants];
}

export function applyLedgerGrounding(plan: WorkspaceBuildPlan, prompt: string): WorkspaceBuildPlan {
  const grants = defaultLedgerCapabilitiesForPrompt(prompt);
  if (!grants.length) return plan;
  const capabilities = [...new Set([...plan.capabilities, ...grants])];
  const groundingNote = "Load Jordan's ledger totals only through granted @findex/workspace-sdk ledger capabilities; never invent balances, spending, or portfolio values.";
  const dataNeeds = plan.dataNeeds.includes(groundingNote)
    ? plan.dataNeeds
    : [...plan.dataNeeds, groundingNote].slice(0, 20);
  const assumptions = plan.assumptions.some((item) => /ledger|jordan|sdk capability/i.test(item))
    ? plan.assumptions
    : [...plan.assumptions, "Personal starting values come from the demo ledger via signed capabilities when available."].slice(0, 12);
  return { ...plan, capabilities, dataNeeds, assumptions };
}

export type PolishClassification = "safe_polish" | "behavior_offer";

const offerPatterns = [
  /\bformula\b/i,
  /\bmethodolog/i,
  /\bcalculation\b/i,
  /\bincorrect (?:financial|math|result)/i,
  /\bmixed[- ]unit/i,
  /\bcapability\b/i,
  /\bledger\./i,
  /\bdefault(?:s| value)?\b/i,
  /\binput(?:s)?\b.*\b(?:missing|add|remove|change)\b/i,
  /\boutput(?:s)?\b.*\b(?:missing|add|remove|change)\b/i,
  /\bnew (?:view|tab|screen|chart)\b/i,
  /\bacceptance criterion failed\b/i,
];

const safePatterns = [
  /\ba11y\b|\bwcag\b|\baccessib|\baria-/i,
  /\blabel\b/i,
  /\bunit(?:s)?\b|\bpercent\b|\bcurrency\b|\busd\b/i,
  /\bdisclosure\b|\bnot financial advice\b/i,
  /\bmin\b|\bmax\b|\bstep\b|\boff-step\b/i,
  /\boverflow\b|\bresponsive\b/i,
  /\bstatus\b|\bpolite\b/i,
  /\bcontrast\b/i,
  /\bh1\b|\bh2\b/i,
  /\btable alternative\b|\bsampled subset\b|\bdata-table\b|\bchart summary\b/i,
];

/** Classify repair diagnostics: ambiguous → offer (never silent behavior change). */
export function classifyPolishDiagnostics(diagnostics: string[]): PolishClassification {
  const text = diagnostics.join("\n");
  if (!text.trim()) return "behavior_offer";
  // Chart/table a11y polish is safe even when review phrases it as an acceptance miss.
  if (/\b(?:table alternative|sampled subset|data-table|chart summary|accessibility defect)\b/i.test(text)) {
    return "safe_polish";
  }
  if (offerPatterns.some((pattern) => pattern.test(text))) return "behavior_offer";
  if (safePatterns.some((pattern) => pattern.test(text))) return "safe_polish";
  return "behavior_offer";
}

export function summarizeUpgradeOffer(diagnostics: string[]) {
  const changes = diagnostics
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 5);
  const summary = changes.length
    ? `I found improvements that change behavior or methodology: ${changes[0]}`
    : "I found improvements that may change how the tool calculates or behaves.";
  return { summary: summary.slice(0, 400), changes };
}

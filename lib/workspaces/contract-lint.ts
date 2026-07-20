import type { WorkspaceBuildPlan, WorkspaceFile } from "./contracts";
import { isOnStep } from "./step-check";

export type WorkspaceContractLintResult = {
  passed: boolean;
  diagnostics: string[];
};

function sourceBlob(files: WorkspaceFile[]) {
  return files.map((file) => file.content).join("\n");
}

function labelPresent(source: string, label: string) {
  const tokens = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 2 && !["the", "and", "for", "your"].includes(token));
  if (!tokens.length) return source.toLowerCase().includes(label.toLowerCase());
  const haystack = source.toLowerCase();
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits >= Math.min(2, tokens.length) && hits / tokens.length >= 0.6;
}

/** Cheap static lint mirroring the host Chromium quality contract before sandbox. */
export function lintWorkspacePlanContract(plan: WorkspaceBuildPlan, files: WorkspaceFile[]): WorkspaceContractLintResult {
  const diagnostics: string[] = [];
  const source = sourceBlob(files);
  if (!/export\s+default/.test(source)) diagnostics.push("src/App.tsx must default-export the React application.");
  if (!/<h1[\s>]|<h2[\s>]/i.test(source)) {
    diagnostics.push("The workspace must render a visible h1 or h2 heading (host Chromium contract waits for h1/h2).");
  }
  if (!/not financial advice/i.test(source)) {
    diagnostics.push("The workspace must include the phrase 'not financial advice' in an educational disclosure.");
  }

  for (const input of plan.inputs) {
    if (!labelPresent(source, input.label)) {
      diagnostics.push(`Missing accessible UI for planned input label '${input.label}'.`);
    }
    if (input.defaultValue && !source.includes(input.defaultValue) && !source.includes(JSON.stringify(input.defaultValue))) {
      diagnostics.push(`Planned default '${input.defaultValue}' for '${input.label}' does not appear in source.`);
    }
    if (["number", "currency", "percentage"].includes(input.type)) {
      const min = input.min === undefined ? NaN : Number(input.min);
      const step = input.step === undefined ? NaN : Number(input.step);
      const defaultValue = input.defaultValue === undefined ? NaN : Number(input.defaultValue);
      if ([min, step, defaultValue].every(Number.isFinite) && step > 0 && !isOnStep(defaultValue, min, step)) {
        diagnostics.push(`Planned default '${input.defaultValue}' for '${input.label}' is off-step from min=${input.min} step=${input.step}.`);
      }
      if (!/\bmin\s*=/.test(source) || !/\bmax\s*=/.test(source) || !/\bstep\s*=/.test(source)) {
        diagnostics.push(`Numeric inputs such as '${input.label}' must set finite min, max, and step attributes.`);
        break;
      }
      // Planned domains must appear as literals (attribute or shared constant). Do not
      // require adjacency to min=/max=/step= — builders often use DEFAULTS/bounds objects.
      for (const [attr, value] of [["min", input.min], ["max", input.max], ["step", input.step]] as const) {
        if (!value) continue;
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const attrLiteral = new RegExp(`${attr}\\s*=\\s*(?:\\{|["'\`])?${escaped}\\b`);
        const valueLiteral = new RegExp(`(?:^|[^\\w.])${escaped}(?:[^\\w.]|$)`);
        if (!attrLiteral.test(source) && !valueLiteral.test(source) && !source.includes(JSON.stringify(value))) {
          diagnostics.push(`Planned ${attr}=${value} for '${input.label}' must appear in source (control attribute or shared constant).`);
        }
      }
    }
    if (input.type === "currency" && !/(usd|dollar|currency|\$)/i.test(source)) {
      diagnostics.push(`Currency input '${input.label}' must expose a currency unit in accessible text.`);
    }
    if (input.type === "percentage" && !/(%|percent)/i.test(source)) {
      diagnostics.push(`Percentage input '${input.label}' must expose percent in accessible text.`);
    }
    if (input.required && !/\brequired\b|aria-required/.test(source)) {
      diagnostics.push(`Required input '${input.label}' must set required or aria-required.`);
    }
  }

  for (const output of plan.outputs) {
    const exact = source.includes(output.label) || source.includes(JSON.stringify(output.label));
    if (!exact && !labelPresent(source, output.label)) {
      diagnostics.push(`Missing visible UI for planned output label '${output.label}'.`);
    } else if (!exact) {
      diagnostics.push(
        `Planned output '${output.label}' must appear verbatim in source (prefer aria-label="${output.label}").`,
      );
    }
  }

  if (plan.inputs.length && !/(onChange|set[A-Z]|useWorkspaceState|useState)/.test(source)) {
    diagnostics.push("Planned inputs require observable state updates (onChange/useState/useWorkspaceState).");
  }

  return { passed: diagnostics.length === 0, diagnostics };
}

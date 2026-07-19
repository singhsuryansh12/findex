import OpenAI from "openai";
import type { Responses } from "openai/resources/responses/responses";
import { start } from "workflow/api";
import { brainRequestSchema, type BrainEvent, type BrainInsightCard } from "@/lib/brain/contracts";
import { classifyBrainIntent } from "@/lib/brain/routing";
import { previousCalendarMonth } from "@/lib/finance/dates";
import {
  compareSpendingPeriods,
  demoData,
  evaluatePurchaseScenario,
  formatMoneyPrecise,
  getCashFlowForecast,
  getFinancialSnapshot,
  getForecast,
  getLastMonthSpending,
  getPreviousMonthPair,
  getPortfolioSnapshot,
  getSpendingSummary,
} from "@/lib/finance/engine";
import { calibrateInitialComplexity, enforceComplexityFloor } from "@/lib/workspaces/complexity";
import type { WorkspaceBuildPlan } from "@/lib/workspaces/contracts";
import { FINDEX_MODELS, independentSignal, planningPolicy, stageDeadlines } from "@/lib/workspaces/model-policy";
import { logModelTrace, normalizeModelError, requireCompletedResponse, traceFor, usageOf, WorkspaceModelError } from "@/lib/workspaces/openai-response";
import { assessBuildComplexity, planWorkspace } from "@/lib/workspaces/planner";
import { sessionFor } from "@/lib/workspaces/session";
import { signClarificationToken, signRunAccessToken, verifyClarificationToken } from "@/lib/workspaces/signing";
import { consumeBrainTurn, consumeWorkspaceBuild, type BrainQuotaState } from "@/lib/workspaces/quotas";
import { financialWorkspaceWorkflow } from "@/workflows/financial-workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

const encoder = new TextEncoder();
const quota = new Map<string, BrainQuotaState>();

const financeTools: Responses.FunctionTool[] = [
  {
    type: "function", name: "get_spending_summary", strict: true,
    description: "Calculate a spending total and transaction count for an exact period and optional Findex category.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        category_id: { type: ["string", "null"] },
        start_date: { type: "string" },
        end_date: { type: "string" },
      },
      required: ["category_id", "start_date", "end_date"],
    },
  },
  {
    type: "function", name: "compare_spending_periods", strict: true,
    description: "Compare deterministic spending totals for two exact periods.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        category_id: { type: ["string", "null"] },
        first_start: { type: "string" }, first_end: { type: "string" },
        second_start: { type: "string" }, second_end: { type: "string" },
      },
      required: ["category_id", "first_start", "first_end", "second_start", "second_end"],
    },
  },
  {
    type: "function", name: "list_recurring_obligations", strict: true,
    description: "List active demo-ledger recurring cash liabilities and their monthly load.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function", name: "get_cashflow_forecast", strict: true,
    description: "Return the trusted 30-day checking forecast and safe-to-spend amount.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function", name: "get_financial_snapshot", strict: true,
    description: "Return deterministic net worth, cash, spending, recurring, and monthly metrics.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function", name: "get_portfolio_snapshot", strict: true,
    description: "Return the deterministic demo investment accounts, allocation, contribution plans, and portfolio history.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function", name: "get_income_cashflow", strict: true,
    description: "Return the deterministic 30, 60, or 90 day income and cash-flow projection.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { days: { type: "integer", enum: [30, 60, 90] } },
      required: ["days"],
    },
  },
  {
    type: "function", name: "evaluate_purchase_scenario", strict: true,
    description: "Compare a proposed purchase with Jordan's deterministic 90-day cash-flow forecast.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        purchase_date: { type: "string" },
        upfront_cost_cents: { type: "integer", minimum: 0 },
        monthly_cost_cents: { type: "integer", minimum: 0 },
      },
      required: ["purchase_date", "upfront_cost_cents", "monthly_cost_cents"],
    },
  },
];

function emit(controller: ReadableStreamDefaultController<Uint8Array>, event: BrainEvent) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

async function emitText(controller: ReadableStreamDefaultController<Uint8Array>, text: string) {
  const chunks = text.match(/.{1,32}(?:\s|$)/g) ?? [text];
  for (const delta of chunks) {
    emit(controller, { type: "assistant_delta", delta });
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}

function validPeriod(startDate: string, endDate: string) {
  const first = demoData.transactions.reduce(
    (value, transaction) => transaction.postedOn < value ? transaction.postedOn : value,
    demoData.metadata.asOfDate,
  );
  return /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
    && startDate >= first
    && endDate <= demoData.metadata.asOfDate
    && startDate <= endDate;
}

function executeFinanceTool(name: string, rawArguments: string) {
  const args = JSON.parse(rawArguments) as Record<string, unknown>;
  const category = typeof args.category_id === "string" ? args.category_id : undefined;
  if (category && !demoData.categories.some((item) => item.id === category)) {
    return { result: { error: "Unsupported category." }, provenance: "No matching category in the demo ledger" };
  }
  if (name === "get_spending_summary") {
    const start = String(args.start_date); const end = String(args.end_date);
    if (!validPeriod(start, end)) return { result: { error: "Period is outside the 12-month demo ledger." }, provenance: "Demo ledger date boundary" };
    const result = getSpendingSummary(start, end, category);
    return { result, provenance: `${result.count} ${result.categoryName} transactions · ${start}–${end}` };
  }
  if (name === "compare_spending_periods") {
    const dates = [args.first_start, args.first_end, args.second_start, args.second_end].map(String);
    if (!validPeriod(dates[0], dates[1]) || !validPeriod(dates[2], dates[3])) {
      return { result: { error: "A comparison period is outside the demo ledger." }, provenance: "Demo ledger date boundary" };
    }
    const result = compareSpendingPeriods(category, dates[0], dates[1], dates[2], dates[3]);
    return { result, provenance: `${result.first.count + result.second.count} transactions across 2 periods` };
  }
  if (name === "list_recurring_obligations") {
    const obligations = demoData.recurringRules
      .filter((rule) => rule.active && rule.amountCents < 0)
      .map(({ name: title, amountCents, cadence }) => ({ name: title, amountCents, cadence }));
    return { result: obligations, provenance: `${obligations.length} active recurring obligations` };
  }
  if (name === "get_cashflow_forecast") {
    const result = getForecast();
    return { result, provenance: `31 daily points · ${result.asOfDate}–${result.throughDate}` };
  }
  if (name === "get_financial_snapshot") return { result: getFinancialSnapshot(), provenance: `Reconciled ledger · as of ${demoData.metadata.asOfDate}` };
  if (name === "get_portfolio_snapshot") return { result: getPortfolioSnapshot(), provenance: `Synthetic holdings · as of ${demoData.metadata.asOfDate}` };
  if (name === "get_income_cashflow") {
    const days = [30, 60, 90].includes(Number(args.days)) ? Number(args.days) as 30 | 60 | 90 : 90;
    return { result: getCashFlowForecast({ days }), provenance: `${days}-day deterministic income and cash-flow model` };
  }
  if (name === "evaluate_purchase_scenario") {
    const result = evaluatePurchaseScenario({
      date: String(args.purchase_date),
      upfrontCostCents: Number(args.upfront_cost_cents),
      monthlyCostCents: Number(args.monthly_cost_cents),
    });
    return { result, provenance: `90-day purchase scenario · ${demoData.metadata.asOfDate} demo ledger` };
  }
  return { result: { error: "Unsupported tool." }, provenance: "No tool result" };
}

function insightFor(name: string, result: unknown, provenance: string): BrainInsightCard | null {
  if (name === "get_spending_summary") {
    const spending = result as ReturnType<typeof getSpendingSummary>;
    return {
      kind: "spending",
      title: `${spending.categoryName} spending, explained`,
      conclusion: `You spent ${formatMoneyPrecise(spending.amountCents)} across ${spending.count} transactions in the selected period.`,
      metrics: [
        { label: "Total", value: formatMoneyPrecise(spending.amountCents) },
        { label: "Transactions", value: String(spending.count) },
        { label: "Top merchant", value: spending.topMerchants[0]?.name ?? "None" },
      ],
      provenance,
      assumptions: [`Period: ${spending.startDate} through ${spending.endDate}`, "Transfers and income are excluded"],
      relatedHref: "/demo/spending",
      relatedLabel: "Review transactions",
    };
  }
  if (name === "get_portfolio_snapshot") {
    const portfolio = result as ReturnType<typeof getPortfolioSnapshot>;
    const largestDrift = [...portfolio.allocation].sort((a, b) => Math.abs(b.driftBasisPoints) - Math.abs(a.driftBasisPoints))[0];
    return {
      kind: "portfolio",
      title: "Your portfolio is broadly diversified",
      conclusion: `${largestDrift?.label ?? "Allocation"} is ${Math.abs((largestDrift?.driftBasisPoints ?? 0) / 100).toFixed(1)} percentage points ${Number(largestDrift?.driftBasisPoints) >= 0 ? "above" : "below"} Jordan's demo target.`,
      metrics: [
        { label: "Invested", value: formatMoneyPrecise(portfolio.investedCents), tone: "positive" },
        { label: "12-month contributions", value: formatMoneyPrecise(portfolio.twelveMonthContributionsCents) },
        { label: "Market movement", value: formatMoneyPrecise(portfolio.twelveMonthMarketMovementCents) },
      ],
      provenance,
      assumptions: ["Deterministic synthetic holdings", "Target allocation is a demo preference, not advice"],
      relatedHref: "/demo/portfolio",
      relatedLabel: "Explore portfolio",
    };
  }
  if (name === "get_income_cashflow" || name === "get_cashflow_forecast") {
    const forecast = name === "get_income_cashflow" ? result as ReturnType<typeof getCashFlowForecast> : getCashFlowForecast({ days: 30 });
    return {
      kind: "cashflow",
      title: "Your near-term cash flow is accounted for",
      conclusion: `Known commitments preserve ${formatMoneyPrecise(forecast.safeToSpendNowCents)} as safe to spend today.`,
      metrics: [
        { label: "Take-home / month", value: formatMoneyPrecise(forecast.monthlyTakeHomeCents) },
        { label: "Expected monthly surplus", value: formatMoneyPrecise(forecast.expectedMonthlySurplusCents), tone: forecast.expectedMonthlySurplusCents >= 0 ? "positive" : "warning" },
        { label: "Lowest checking", value: formatMoneyPrecise(forecast.lowestBalanceCents) },
      ],
      provenance,
      assumptions: ["Known recurring commitments", "Flexible spending uses the trailing three complete months"],
      relatedHref: "/demo/cash-flow",
      relatedLabel: "Open cash flow",
    };
  }
  if (name === "evaluate_purchase_scenario") {
    const scenario = result as ReturnType<typeof evaluatePurchaseScenario>;
    return {
      kind: "decision",
      title: scenario.status === "covered" ? "This purchase is covered" : scenario.status === "tight" ? "This purchase would make cash flow tight" : "This purchase is not covered",
      conclusion: scenario.explanation,
      status: scenario.status,
      metrics: [
        { label: "Base lowest checking", value: formatMoneyPrecise(scenario.lowestBalanceBeforeCents) },
        { label: "Scenario lowest checking", value: formatMoneyPrecise(scenario.lowestBalanceAfterCents), tone: scenario.status === "covered" ? "positive" : "warning" },
        { label: "Safe to spend after", value: formatMoneyPrecise(scenario.safeToSpendAfterCents) },
      ],
      provenance,
      assumptions: [`${formatMoneyPrecise(scenario.scenario.upfrontCostCents)} upfront on ${scenario.scenario.date}`, `${formatMoneyPrecise(scenario.scenario.monthlyCostCents)} recurring monthly cost`, "No financing interest, insurance, tax, or resale value unless included"],
      relatedHref: "/demo/cash-flow",
      relatedLabel: "Inspect the forecast",
    };
  }
  return null;
}

async function deterministicLedgerAnswer(message: string, controller: ReadableStreamDefaultController<Uint8Array>) {
  const lower = message.toLowerCase();
  if (lower.includes("dining") && (lower.includes("last month") || lower.includes("june"))) {
    const summary = getLastMonthSpending("dining");
    const { first, second } = getPreviousMonthPair();
    const comparison = compareSpendingPeriods("dining", first.start, first.end, second.start, second.end);
    const provenance = `${summary.count} Dining transactions · Jun 1–30`;
    emit(controller, { type: "tool_result", tool: "get_spending_summary", summary: formatMoneyPrecise(summary.amountCents), provenance });
    emit(controller, { type: "insight_card", card: insightFor("get_spending_summary", summary, provenance)! });
    await emitText(controller, `You spent ${formatMoneyPrecise(summary.amountCents)} dining out last month across ${summary.count} transactions. That was ${formatMoneyPrecise(Math.abs(comparison.deltaCents))} ${comparison.deltaCents >= 0 ? "more" : "less"} than May.`);
    return true;
  }
  if ((lower.includes("where did") || lower.includes("spending")) && lower.includes("last month")) {
    const summary = getLastMonthSpending();
    const provenance = `${summary.count} spending transactions · Jun 1–30`;
    emit(controller, { type: "tool_result", tool: "get_spending_summary", summary: formatMoneyPrecise(summary.amountCents), provenance });
    emit(controller, { type: "insight_card", card: insightFor("get_spending_summary", summary, provenance)! });
    await emitText(controller, `You spent ${formatMoneyPrecise(summary.amountCents)} last month across ${summary.count} transactions. ${summary.topMerchants[0]?.name ?? "Your top merchant"} was the largest merchant total.`);
    return true;
  }
  if (lower.includes("safe to spend") || lower.includes("cashflow") || lower.includes("cash flow")) {
    const forecast = getForecast();
    const provenance = `31 daily points · ${forecast.asOfDate}–${forecast.throughDate}`;
    emit(controller, { type: "tool_result", tool: "get_cashflow_forecast", summary: formatMoneyPrecise(forecast.safeToSpendNowCents), provenance });
    emit(controller, { type: "insight_card", card: insightFor("get_cashflow_forecast", forecast, provenance)! });
    await emitText(controller, `Your protected safe-to-spend amount is ${formatMoneyPrecise(forecast.safeToSpendNowCents)}. It preserves your ${formatMoneyPrecise(forecast.reserveFloorCents)} reserve after known income and liabilities.`);
    return true;
  }
  if (lower.includes("recurring") || lower.includes("subscription")) {
    const obligations = demoData.recurringRules.filter((rule) => rule.active && rule.amountCents < 0);
    const total = obligations.reduce((sum, rule) => sum + Math.abs(rule.amountCents), 0);
    emit(controller, { type: "tool_result", tool: "list_recurring_obligations", summary: formatMoneyPrecise(total), provenance: `${obligations.length} active recurring obligations` });
    emit(controller, { type: "insight_card", card: {
      kind: "recurring", title: "Your recurring money is visible", conclusion: `${obligations.length} active obligations total ${formatMoneyPrecise(total)} in modeled monthly commitments.`,
      metrics: [{ label: "Monthly commitments", value: formatMoneyPrecise(total) }, { label: "Active items", value: String(obligations.length) }, { label: "Subscriptions", value: "5" }],
      provenance: `${obligations.length} active recurring obligations`, assumptions: ["Active deterministic recurring rules", "Investment contributions are shown separately"], relatedHref: "/demo/spending", relatedLabel: "Review recurring activity",
    } });
    await emitText(controller, `You have ${obligations.length} active recurring obligations totaling ${formatMoneyPrecise(total)} in modeled monthly commitments.`);
    return true;
  }
  if (lower.includes("portfolio") && (lower.includes("balance") || lower.includes("allocation") || lower.includes("how is"))) {
    const result = getPortfolioSnapshot();
    const provenance = `Synthetic holdings · as of ${demoData.metadata.asOfDate}`;
    emit(controller, { type: "tool_result", tool: "get_portfolio_snapshot", summary: formatMoneyPrecise(result.investedCents), provenance });
    emit(controller, { type: "insight_card", card: insightFor("get_portfolio_snapshot", result, provenance)! });
    await emitText(controller, `You have ${formatMoneyPrecise(result.investedCents)} invested across four demo accounts. The allocation is close to Jordan's saved 60/20/15/5 target.`);
    return true;
  }
  if (lower.includes("afford") || lower.includes("car")) {
    const amounts = [...message.matchAll(/\$([\d,]+(?:\.\d{1,2})?)/g)].map((match) => Math.round(Number(match[1]!.replaceAll(",", "")) * 100));
    const isoDate = message.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
    if (amounts.length < 2 || !isoDate) {
      await emitText(controller, "Tell me the purchase date, upfront amount, and monthly payment so I can compare the decision with your 90-day cash flow.");
      return true;
    }
    const result = evaluatePurchaseScenario({ date: isoDate, upfrontCostCents: amounts[0]!, monthlyCostCents: amounts[1]! });
    const provenance = `90-day purchase scenario · ${demoData.metadata.asOfDate} demo ledger`;
    emit(controller, { type: "tool_result", tool: "evaluate_purchase_scenario", summary: result.status, provenance });
    emit(controller, { type: "insight_card", card: insightFor("evaluate_purchase_scenario", result, provenance)! });
    await emitText(controller, result.explanation);
    return true;
  }
  return false;
}

async function answerFinancialQuestion(
  client: OpenAI,
  body: ReturnType<typeof brainRequestSchema.parse>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  signal: AbortSignal,
) {
  const previous = previousCalendarMonth(demoData.metadata.asOfDate);
  const categories = demoData.categories.map((category) => `${category.id}=${category.name}`).join(", ");
  let transientRetriesRemaining = 1;
  const withTransientRetry = async <T,>(operation: () => Promise<T>) => {
    try {
      return await operation();
    } catch (error) {
      if (normalizeModelError(error).code !== "MODEL_TRANSIENT" || transientRetriesRemaining === 0) throw error;
      transientRetriesRemaining -= 1;
      return operation();
    }
  };
  const first = await withTransientRetry(() => client.responses.create({
    model: FINDEX_MODELS.terra,
    reasoning: { effort: "low" },
    instructions: `Answer from Findex's mocked USD ledger as of ${demoData.metadata.asOfDate}. Previous calendar month is ${previous.startDate} through ${previous.endDate}. Categories: ${categories}. Use a function for every numeric claim. Never invent transactions or calculate monetary totals yourself. Be concise and educational, not financial advice.`,
    input: [...body.history.slice(-12), { role: "user" as const, content: body.message }],
    tools: financeTools,
    tool_choice: "required",
    parallel_tool_calls: false,
    max_output_tokens: 1_200,
  }, { signal, maxRetries: 0 }));
  requireCompletedResponse(first, "the financial answer");
  const calls = first.output.filter((item): item is Responses.ResponseFunctionToolCall => item.type === "function_call");
  if (!calls.length) {
    await emitText(controller, first.output_text || "I couldn’t ground that answer in the demo ledger.");
    return usageOf(first);
  }
  const outputs = calls.map((call) => {
    const execution = executeFinanceTool(call.name, call.arguments);
    emit(controller, { type: "tool_result", tool: call.name, summary: JSON.stringify(execution.result).slice(0, 180), provenance: execution.provenance });
    const card = insightFor(call.name, execution.result, execution.provenance);
    if (card) emit(controller, { type: "insight_card", card });
    return { type: "function_call_output" as const, call_id: call.call_id, output: JSON.stringify(execution.result) };
  });
  const stream = await withTransientRetry(() => client.responses.create({
    model: FINDEX_MODELS.terra,
    reasoning: { effort: "low" },
    previous_response_id: first.id,
    input: outputs,
    tools: financeTools,
    max_output_tokens: 1_200,
    stream: true,
  }, { signal, maxRetries: 0 }));
  let finalResponse: Responses.Response | null = null;
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") emit(controller, { type: "assistant_delta", delta: event.delta });
    if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") finalResponse = event.response;
  }
  if (!finalResponse) throw new WorkspaceModelError("MODEL_FAILED", "Findex could not complete the financial answer.");
  requireCompletedResponse(finalResponse, "the financial answer");
  return addUsage(usageOf(first), usageOf(finalResponse));
}

function currentQuota(sessionId: string) {
  const date = new Date().toISOString().slice(0, 10);
  const existing = quota.get(sessionId);
  if (!existing || existing.date !== date) {
    const next = { date, turns: 0, builds: 0 };
    quota.set(sessionId, next);
    return next;
  }
  return existing;
}

function addUsage(...items: Array<{ inputTokens: number; outputTokens: number; totalTokens: number }>) {
  return items.reduce((total, item) => ({
    inputTokens: total.inputTokens + item.inputTokens,
    outputTokens: total.outputTokens + item.outputTokens,
    totalTokens: total.totalTokens + item.totalTokens,
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
}

async function orchestrate(
  body: ReturnType<typeof brainRequestSchema.parse>,
  sessionId: string,
  state: ReturnType<typeof currentQuota>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  signal: AbortSignal,
  requestId: string,
) {
  if (!process.env.OPENAI_API_KEY) {
    if (await deterministicLedgerAnswer(body.message, controller)) return;
    emit(controller, {
      type: "workspace_failed",
      code: "BUILD_UNAVAILABLE",
      message: "Findex couldn't start a workspace build because secure generation is unavailable. Nothing was published.",
      recoverable: true,
    });
    return;
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  if (classifyBrainIntent(body.message, {
    hasActiveWorkspace: Boolean(body.activeWorkspace),
    hasClarificationToken: Boolean(body.clarificationToken),
  }) === "financial_question") {
    const startedAt = Date.now();
    try {
      const usage = await answerFinancialQuestion(client, body, controller, independentSignal(stageDeadlines.financialAnswerMs, signal));
      logModelTrace(requestId, traceFor({
        stage: "financial_answer", model: FINDEX_MODELS.terra, effort: "low", attempt: 1,
        durationMs: Date.now() - startedAt, usage, outcome: "completed",
      }));
    } catch (rawError) {
      const error = normalizeModelError(rawError, "financial answer");
      const outcome = error.code === "PLAN_REFUSED" ? "refused"
        : error.code === "PLAN_TIMEOUT" ? "timed_out"
          : error.code === "PLAN_TOKEN_LIMIT" ? "incomplete" : "failed";
      logModelTrace(requestId, traceFor({
        stage: "financial_answer", model: FINDEX_MODELS.terra, effort: "low", attempt: 1,
        durationMs: Date.now() - startedAt, usage: error.metadata.usage, outcome,
        responseId: error.metadata.responseId, incompleteReason: error.metadata.incompleteReason,
      }));
      emit(controller, {
        type: "error",
        message: error.code === "PLAN_REFUSED"
          ? "Findex couldn't answer that request safely."
          : "Findex couldn't answer that right now. Please try again.",
        recoverable: error.code !== "PLAN_REFUSED",
      });
    }
    return;
  }
  let prompt = body.message;
  let clarificationRoundComplete = false;
  if (body.clarificationToken) {
    const token = verifyClarificationToken(body.clarificationToken, sessionId);
    if (!token || token.activeProjectId !== (body.activeWorkspace?.projectId ?? null)) {
      emit(controller, { type: "workspace_failed", message: "That clarification request expired or belongs to another workspace. Please submit the original request again.", recoverable: true });
      return;
    }
    prompt = token.originalPrompt;
    clarificationRoundComplete = true;
  }

  emit(controller, { type: "build_progress", phase: "assessing", detail: "Findex is assessing scope, risk, and implementation complexity" });
  const assessmentStartedAt = Date.now();
  const assessed = await assessBuildComplexity(client, prompt, body.activeWorkspace, body.clarificationAnswers, signal, requestId);
  const assessmentMs = Date.now() - assessmentStartedAt;
  let assessment = calibrateInitialComplexity(assessed.assessment, prompt, Boolean(body.activeWorkspace));
  const initialPlanningPolicy = planningPolicy(assessment.level);
  emit(controller, { type: "build_progress", phase: "planning", detail: "Findex is planning your workspace", complexity: assessment.level });
  const planningStartedAt = Date.now();
  const planned = await planWorkspace(client, {
    prompt,
    active: body.activeWorkspace,
    clarificationAnswers: body.clarificationAnswers,
    clarificationRoundComplete,
    effort: initialPlanningPolicy.effort,
    assessment,
    signal,
    requestId,
  });
  const planningMs = Date.now() - planningStartedAt;
  assessment = enforceComplexityFloor(assessment, planned.plan);

  const plan: WorkspaceBuildPlan = planned.plan;
  if (plan.intent === "answer") {
    if (plan.capabilities.some((capability) => capability.startsWith("ledger."))) await answerFinancialQuestion(client, body, controller, independentSignal(stageDeadlines.financialAnswerMs, signal));
    else await emitText(controller, plan.response || "Findex builds finance-native browser workspaces and answers questions grounded in the demo ledger.");
    return;
  }
  if (plan.intent === "clarify" && !clarificationRoundComplete) {
    if (!plan.clarificationQuestions.length) {
      await emitText(controller, plan.response || "Please describe the financial decision or workflow you want the workspace to support.");
      return;
    }
    const token = signClarificationToken(sessionId, prompt, body.activeWorkspace?.projectId ?? null);
    emit(controller, { type: "build_progress", phase: "clarifying", detail: "Waiting for one focused clarification round", complexity: assessment.level });
    emit(controller, { type: "clarification_required", questions: plan.clarificationQuestions, token, planTitle: plan.title });
    return;
  }
  if (!new Set(["create", "revise"]).has(plan.intent)) {
    await emitText(controller, plan.response || "That request is outside the finance workspace scope.");
    return;
  }
  if (!consumeWorkspaceBuild(state)) {
    emit(controller, { type: "workspace_failed", message: "This demo session has reached its daily limit of ten workspace builds and revisions.", recoverable: false });
    return;
  }
  const run = await start(financialWorkspaceWorkflow, [{
    requestId,
    prompt,
    plan,
    assessment,
    active: plan.intent === "revise" ? body.activeWorkspace : null,
    sessionId,
    initialUsage: addUsage(assessed.usage, planned.usage),
    initialTimings: { assessmentMs, planningMs },
    initialTraces: [...assessed.traces, ...planned.traces],
    deadlineAt: Date.now() + stageDeadlines.workflowMs,
  }]);
  const accessToken = signRunAccessToken(sessionId, run.runId);
  console.info(JSON.stringify({ event: "findex_workflow_started", requestId, runId: run.runId, complexity: assessment.level }));
  emit(controller, { type: "workspace_started", runId: run.runId, accessToken });
}

export async function POST(request: Request) {
  const parsed = brainRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid Brain request.", issues: parsed.error.issues }, { status: 400 });
  const session = sessionFor(request);
  const requestId = crypto.randomUUID();
  const state = currentQuota(session.id);
  if (!consumeBrainTurn(state)) return Response.json({ error: "This demo session has reached its daily 25-turn limit." }, { status: 429 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const signal = independentSignal(stageDeadlines.brainRequestMs, request.signal);
      try {
        await orchestrate(parsed.data, session.id, state, controller, signal, requestId);
      } catch (error) {
        const modelError = error instanceof WorkspaceModelError ? error : normalizeModelError(error, "request");
        console.warn(JSON.stringify({ event: "findex_brain_failed", requestId, code: modelError.code }));
        emit(controller, {
          type: "workspace_failed",
          message: modelError.code === "PLAN_TIMEOUT"
            ? "Findex couldn't finish planning in time; nothing was published. Your previous workspace is unchanged."
            : modelError.code === "PLAN_REFUSED"
              ? "Findex couldn't plan that request safely; nothing was published."
              : modelError.code === "PLAN_TOKEN_LIMIT"
                ? "Findex couldn't finish planning within the available response capacity; nothing was published."
                : "Findex couldn't finish planning; nothing was published. Your previous workspace is unchanged.",
          recoverable: modelError.code !== "PLAN_REFUSED",
          code: modelError.code,
        });
      } finally {
        controller.close();
      }
    },
  });

  const headers = new Headers({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  if (session.cookie) headers.set("set-cookie", session.cookie);
  return new Response(stream, { headers });
}

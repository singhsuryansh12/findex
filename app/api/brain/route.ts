import OpenAI from "openai";
import type { Responses } from "openai/resources/responses/responses";
import { brainRequestSchema, type BrainEvent } from "@/lib/brain/contracts";
import { previousCalendarMonth } from "@/lib/finance/dates";
import {
  compareSpendingPeriods,
  demoData,
  formatMoneyPrecise,
  getFinancialSnapshot,
  getForecast,
  getLastMonthSpending,
  getPreviousMonthPair,
  getSpendingSummary,
} from "@/lib/finance/engine";
import { complexityPolicy, enforceComplexityFloor } from "@/lib/workspaces/complexity";
import type { WorkspaceBuildPlan } from "@/lib/workspaces/contracts";
import { generateWorkspace } from "@/lib/workspaces/generator";
import { assessBuildComplexity, planWorkspace, workspaceModel } from "@/lib/workspaces/planner";
import { sessionFor } from "@/lib/workspaces/session";
import { signClarificationToken, verifyClarificationToken } from "@/lib/workspaces/signing";
import { consumeBrainTurn, consumeWorkspaceBuild, type BrainQuotaState } from "@/lib/workspaces/quotas";

export const runtime = "nodejs";
export const maxDuration = 300;

const encoder = new TextEncoder();
const quota = new Map<string, BrainQuotaState>();

const financeTools: Responses.FunctionTool[] = [
  {
    type: "function", name: "get_spending_summary", strict: true,
    description: "Calculate a spending total and transaction count for an exact period and optional FinDex category.",
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
  return { result: { error: "Unsupported tool." }, provenance: "No tool result" };
}

async function deterministicLedgerAnswer(message: string, controller: ReadableStreamDefaultController<Uint8Array>) {
  const lower = message.toLowerCase();
  if (lower.includes("dining") && (lower.includes("last month") || lower.includes("june"))) {
    const summary = getLastMonthSpending("dining");
    const { first, second } = getPreviousMonthPair();
    const comparison = compareSpendingPeriods("dining", first.start, first.end, second.start, second.end);
    emit(controller, { type: "tool_result", tool: "get_spending_summary", summary: formatMoneyPrecise(summary.amountCents), provenance: `${summary.count} Dining transactions · Jun 1–30` });
    await emitText(controller, `You spent ${formatMoneyPrecise(summary.amountCents)} dining out last month across ${summary.count} transactions. That was ${formatMoneyPrecise(Math.abs(comparison.deltaCents))} ${comparison.deltaCents >= 0 ? "more" : "less"} than May.`);
    return true;
  }
  if (lower.includes("safe to spend") || lower.includes("cashflow") || lower.includes("cash flow")) {
    const forecast = getForecast();
    emit(controller, { type: "tool_result", tool: "get_cashflow_forecast", summary: formatMoneyPrecise(forecast.safeToSpendNowCents), provenance: `31 daily points · ${forecast.asOfDate}–${forecast.throughDate}` });
    await emitText(controller, `Your protected safe-to-spend amount is ${formatMoneyPrecise(forecast.safeToSpendNowCents)}. It preserves your ${formatMoneyPrecise(forecast.reserveFloorCents)} reserve after known income and liabilities.`);
    return true;
  }
  if (lower.includes("recurring") || lower.includes("subscription")) {
    const obligations = demoData.recurringRules.filter((rule) => rule.active && rule.amountCents < 0);
    const total = obligations.reduce((sum, rule) => sum + Math.abs(rule.amountCents), 0);
    emit(controller, { type: "tool_result", tool: "list_recurring_obligations", summary: formatMoneyPrecise(total), provenance: `${obligations.length} active recurring obligations` });
    await emitText(controller, `You have ${obligations.length} active recurring obligations totaling ${formatMoneyPrecise(total)} in modeled monthly commitments.`);
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
  const first = await client.responses.create({
    model: workspaceModel(),
    reasoning: { effort: "low" },
    instructions: `Answer from FinDex's mocked USD ledger as of ${demoData.metadata.asOfDate}. Previous calendar month is ${previous.startDate} through ${previous.endDate}. Categories: ${categories}. Use a function for every numeric claim. Never invent transactions or calculate monetary totals yourself. Be concise and educational, not financial advice.`,
    input: [...body.history.slice(-12), { role: "user" as const, content: body.message }],
    tools: financeTools,
    tool_choice: "required",
    parallel_tool_calls: false,
    max_output_tokens: 1_200,
  }, { signal });
  const calls = first.output.filter((item): item is Responses.ResponseFunctionToolCall => item.type === "function_call");
  if (!calls.length) {
    await emitText(controller, first.output_text || "I couldn’t ground that answer in the demo ledger.");
    return;
  }
  const outputs = calls.map((call) => {
    const execution = executeFinanceTool(call.name, call.arguments);
    emit(controller, { type: "tool_result", tool: call.name, summary: JSON.stringify(execution.result).slice(0, 180), provenance: execution.provenance });
    return { type: "function_call_output" as const, call_id: call.call_id, output: JSON.stringify(execution.result) };
  });
  const stream = await client.responses.create({
    model: workspaceModel(),
    reasoning: { effort: "low" },
    previous_response_id: first.id,
    input: outputs,
    tools: financeTools,
    max_output_tokens: 1_200,
    stream: true,
  }, { signal });
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") emit(controller, { type: "assistant_delta", delta: event.delta });
  }
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
) {
  if (!process.env.OPENAI_API_KEY) {
    if (await deterministicLedgerAnswer(body.message, controller)) return;
    emit(controller, { type: "workspace_failed", message: "Generative workspaces require OPENAI_API_KEY. No canned or unrelated workspace was substituted.", recoverable: true });
    return;
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

  emit(controller, { type: "build_progress", phase: "assessing", detail: "Sol is assessing scope, risk, and implementation complexity" });
  const assessmentStartedAt = Date.now();
  const assessed = await assessBuildComplexity(client, prompt, body.activeWorkspace, body.clarificationAnswers, signal);
  const assessmentMs = Date.now() - assessmentStartedAt;
  let assessment = assessed.assessment;
  let effort = complexityPolicy[assessment.level].effort;
  let tierSignal = AbortSignal.any([signal, AbortSignal.timeout(complexityPolicy[assessment.level].budgetMs)]);
  let planningMs = 0;
  emit(controller, { type: "build_progress", phase: "planning", detail: `Sol is planning with ${effort} reasoning`, complexity: assessment.level });
  let planningStartedAt = Date.now();
  let planned = await planWorkspace(client, {
    prompt,
    active: body.activeWorkspace,
    clarificationAnswers: body.clarificationAnswers,
    clarificationRoundComplete,
    effort,
    assessment,
    signal: tierSignal,
  });
  planningMs += Date.now() - planningStartedAt;
  for (let escalation = 0; escalation < 2; escalation += 1) {
    const floored = enforceComplexityFloor(assessment, planned.plan);
    if (floored.level === assessment.level) {
      assessment = floored;
      break;
    }
    assessment = floored;
    effort = complexityPolicy[assessment.level].effort;
    tierSignal = AbortSignal.any([signal, AbortSignal.timeout(complexityPolicy[assessment.level].budgetMs)]);
    emit(controller, { type: "build_progress", phase: "planning", detail: `Declared capabilities raised planning to ${effort} reasoning`, complexity: assessment.level });
    planningStartedAt = Date.now();
    const replanned = await planWorkspace(client, {
      prompt,
      active: body.activeWorkspace,
      clarificationAnswers: body.clarificationAnswers,
      clarificationRoundComplete,
      effort,
      assessment,
      signal: tierSignal,
    });
    planningMs += Date.now() - planningStartedAt;
    planned = { plan: replanned.plan, usage: addUsage(planned.usage, replanned.usage) };
  }
  assessment = enforceComplexityFloor(assessment, planned.plan);
  effort = complexityPolicy[assessment.level].effort;

  const plan: WorkspaceBuildPlan = planned.plan;
  if (plan.intent === "answer") {
    if (plan.capabilities.some((capability) => capability.startsWith("ledger."))) await answerFinancialQuestion(client, body, controller, signal);
    else await emitText(controller, plan.response || "FinDex builds finance-native browser workspaces and answers questions grounded in the demo ledger.");
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
  const artifact = await generateWorkspace({
    client,
    prompt,
    plan,
    assessment,
    active: plan.intent === "revise" ? body.activeWorkspace : null,
    sessionId,
    initialUsage: addUsage(assessed.usage, planned.usage),
    initialTimings: { assessmentMs, planningMs },
    onProgress: (phase, detail) => emit(controller, { type: "build_progress", phase, detail, complexity: assessment.level }),
    signal: tierSignal,
  });
  emit(controller, { type: "workspace_published", artifact });
  const assumptionSummary = artifact.plan.assumptions.length
    ? ` Remaining assumptions: ${artifact.plan.assumptions.slice(0, 3).join("; ")}.`
    : " No unstated assumptions remain.";
  await emitText(controller, `${artifact.title} passed ${artifact.validation.checks.length} checks and an independent Sol review. It is saved as version ${artifact.version}; continue prompting to revise it.${assumptionSummary}`);
}

export async function POST(request: Request) {
  const parsed = brainRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid Brain request.", issues: parsed.error.issues }, { status: 400 });
  const session = sessionFor(request);
  const state = currentQuota(session.id);
  if (!consumeBrainTurn(state)) return Response.json({ error: "This demo session has reached its daily 25-turn limit." }, { status: 429 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(295_000)]);
      try {
        await orchestrate(parsed.data, session.id, state, controller, signal);
      } catch (error) {
        const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
        emit(controller, {
          type: "workspace_failed",
          message: timedOut
            ? "The build timed out. The previously published workspace is unchanged and you can retry safely."
            : error instanceof Error ? error.message : "The request failed. The previously published workspace is unchanged.",
          recoverable: true,
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

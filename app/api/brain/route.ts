import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import OpenAI from "openai";
import type { Responses } from "openai/resources/responses/responses";
import { brainRequestSchema, type BrainEvent } from "@/lib/brain/contracts";
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
import { previousCalendarMonth } from "@/lib/finance/dates";
import { createFireWidgetSpec, type WidgetSpec } from "@/lib/widgets/contracts";
import { generateWidget } from "@/lib/widgets/generator";

export const runtime = "nodejs";
export const maxDuration = 120;

const encoder = new TextEncoder();
const quota = new Map<string, { turns: number; widgets: number }>();
const COOKIE = "findex_demo_session";

const financeTools: Responses.FunctionTool[] = [
  {
    type: "function", name: "get_spending_summary", strict: true,
    description: "Calculate a spending total and transaction count for an exact period and optional category.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        category_id: { type: ["string", "null"], description: "FinDex category ID or null for all spending." },
        start_date: { type: "string", description: "Inclusive ISO date." },
        end_date: { type: "string", description: "Inclusive ISO date." },
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
    description: "List active mocked recurring cash liabilities and their deterministic monthly load.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function", name: "get_cashflow_forecast", strict: true,
    description: "Return the tested 30-day checking forecast, lowest point, and safe-to-spend amount.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function", name: "get_financial_snapshot", strict: true,
    description: "Return top-level deterministic net worth, cash, spending, and recurring metrics.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function", name: "request_widget", strict: true,
    description: "Request a sanitized, validated interactive financial widget.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { kind: { type: "string", enum: ["fire_calculator"] } },
      required: ["kind"],
    },
  },
];

function sign(id: string) {
  const secret = process.env.DEMO_SESSION_SECRET ?? "local-findex-demo-only";
  return createHmac("sha256", secret).update(id).digest("base64url");
}

function sessionFor(request: Request) {
  const raw = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (raw) {
    const [id, provided] = raw.split(".");
    if (id && provided) {
      const expected = sign(id);
      const left = Buffer.from(expected);
      const right = Buffer.from(provided);
      if (left.length === right.length && timingSafeEqual(left, right)) return { id, cookie: null };
    }
  }
  const id = randomUUID();
  return { id, cookie: `${COOKIE}=${id}.${sign(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${process.env.NODE_ENV === "production" ? "; Secure" : ""}` };
}

function emit(controller: ReadableStreamDefaultController<Uint8Array>, event: BrainEvent) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

async function emitText(controller: ReadableStreamDefaultController<Uint8Array>, text: string) {
  const chunks = text.match(/.{1,30}(?:\s|$)/g) ?? [text];
  for (const delta of chunks) {
    emit(controller, { type: "text_delta", delta });
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
}

function validPeriod(startDate: string, endDate: string) {
  const first = demoData.transactions.reduce((value, transaction) => transaction.postedOn < value ? transaction.postedOn : value, demoData.metadata.asOfDate);
  return /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && startDate >= first && endDate <= demoData.metadata.asOfDate && startDate <= endDate;
}

function executeTool(name: string, rawArguments: string) {
  const args = JSON.parse(rawArguments) as Record<string, unknown>;
  const category = typeof args.category_id === "string" ? args.category_id : undefined;
  if (category && !demoData.categories.some((item) => item.id === category)) return { result: { error: "Unsupported category." }, provenance: "No matching category in the demo ledger" };

  if (name === "get_spending_summary") {
    const start = String(args.start_date); const end = String(args.end_date);
    if (!validPeriod(start, end)) return { result: { error: "Period is outside the 12-month demo ledger." }, provenance: "Demo ledger date boundary" };
    const result = getSpendingSummary(start, end, category);
    return { result, provenance: `${result.count} ${result.categoryName} transactions · ${start}–${end}` };
  }
  if (name === "compare_spending_periods") {
    const dates = [args.first_start, args.first_end, args.second_start, args.second_end].map(String);
    if (!validPeriod(dates[0], dates[1]) || !validPeriod(dates[2], dates[3])) return { result: { error: "A comparison period is outside the demo ledger." }, provenance: "Demo ledger date boundary" };
    const result = compareSpendingPeriods(category, dates[0], dates[1], dates[2], dates[3]);
    return { result, provenance: `${result.first.count + result.second.count} transactions across 2 periods` };
  }
  if (name === "list_recurring_obligations") {
    const obligations = demoData.recurringRules.filter((rule) => rule.active && rule.amountCents < 0).map(({ name: title, amountCents, cadence }) => ({ name: title, amountCents, cadence }));
    return { result: obligations, provenance: `${obligations.length} active recurring obligations` };
  }
  if (name === "get_cashflow_forecast") {
    const result = getForecast();
    return { result: { ...result, points: result.points.map(({ date, projectedBalanceCents, safeToSpendCents, events }) => ({ date, projectedBalanceCents, safeToSpendCents, events })) }, provenance: `31 daily points · ${result.asOfDate}–${result.throughDate}` };
  }
  if (name === "get_financial_snapshot") return { result: getFinancialSnapshot(), provenance: `Reconciled ledger · as of ${demoData.metadata.asOfDate}` };
  if (name === "request_widget") return { result: { accepted: true, kind: "fire_calculator" }, provenance: "Sanitized WidgetSpec v1" };
  return { result: { error: "Unsupported tool." }, provenance: "No tool result" };
}

async function deterministicDemoResponse(message: string, controller: ReadableStreamDefaultController<Uint8Array>, state: { widgets: number }, signal: AbortSignal) {
  const lower = message.toLowerCase();
  if (/\b(build|create|make|generate)\b/.test(lower) && /\b(fire|calculator|widget|tool)\b/.test(lower)) {
    if (state.widgets >= 3) {
      await emitText(controller, "This demo session has reached its limit of three live widget generations. Your last verified artifact remains available.");
      return true;
    }
    state.widgets += 1;
    emit(controller, { type: "status", status: "querying", detail: "Preparing a sanitized WidgetSpec" });
    const spec = createFireWidgetSpec();
    emit(controller, { type: "tool_result", tool: "request_widget", summary: spec.title, provenance: "WidgetSpec v1 · aggregated mock data only" });
    emit(controller, { type: "status", status: "sandboxing" });
    emit(controller, { type: "status", status: "coding" });
    const artifact = await generateWidget(spec, signal);
    emit(controller, { type: "status", status: "validating" });
    emit(controller, { type: "status", status: "rendering" });
    emit(controller, { type: "widget", artifact });
    await emitText(controller, artifact.mode === "live"
      ? "Your FIRE calculator passed the sandbox checks and is now part of the dashboard. Adjust any assumption to see the projection update instantly."
      : "Live generation is not configured, so I loaded the clearly labeled verified sample FIRE calculator. It is fully interactive; you can retry the live build from its header.");
    return true;
  }
  if (lower.includes("dining") && (lower.includes("last month") || lower.includes("june"))) {
    emit(controller, { type: "status", status: "querying" });
    const summary = getLastMonthSpending("dining");
    const { first, second } = getPreviousMonthPair();
    const comparison = compareSpendingPeriods("dining", first.start, first.end, second.start, second.end);
    emit(controller, { type: "tool_result", tool: "get_spending_summary", summary: formatMoneyPrecise(summary.amountCents), provenance: `${summary.count} Dining transactions · Jun 1–30` });
    const direction = comparison.deltaCents >= 0 ? "more" : "less";
    await emitText(controller, `You spent ${formatMoneyPrecise(summary.amountCents)} dining out last month across ${summary.count} transactions. That was ${formatMoneyPrecise(Math.abs(comparison.deltaCents))} ${direction} than May.`);
    return true;
  }
  if (lower.includes("safe to spend") || lower.includes("cashflow") || lower.includes("cash flow")) {
    emit(controller, { type: "status", status: "querying" });
    const forecast = getForecast();
    emit(controller, { type: "tool_result", tool: "get_cashflow_forecast", summary: formatMoneyPrecise(forecast.safeToSpendNowCents), provenance: `31 daily points · ${forecast.asOfDate}–${forecast.throughDate}` });
    await emitText(controller, `Your protected safe-to-spend amount is ${formatMoneyPrecise(forecast.safeToSpendNowCents)}. It uses the lowest projected checking balance over 30 days, after known income and liabilities, while preserving your ${formatMoneyPrecise(forecast.reserveFloorCents)} reserve.`);
    return true;
  }
  if (lower.includes("recurring") || lower.includes("subscription")) {
    emit(controller, { type: "status", status: "querying" });
    const obligations = demoData.recurringRules.filter((rule) => rule.active && rule.amountCents < 0);
    const total = obligations.reduce((sum, rule) => sum + Math.abs(rule.amountCents), 0);
    emit(controller, { type: "tool_result", tool: "list_recurring_obligations", summary: formatMoneyPrecise(total), provenance: `${obligations.length} active recurring obligations` });
    await emitText(controller, `You have ${obligations.length} active recurring obligations totaling ${formatMoneyPrecise(total)} in modeled monthly cash commitments. They are already included in the forecast when their due dates fall inside the next 30 days.`);
    return true;
  }
  return false;
}

async function openAIResponse(body: ReturnType<typeof brainRequestSchema.parse>, controller: ReadableStreamDefaultController<Uint8Array>, state: { widgets: number }, signal: AbortSignal) {
  if (!process.env.OPENAI_API_KEY) {
    await emitText(controller, "I can answer spending, recurring-cost, and 30-day cashflow questions from this demo ledger. Try “How much did I spend on dining out last month?”");
    return;
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const previous = previousCalendarMonth(demoData.metadata.asOfDate);
  const categories = demoData.categories.map((category) => `${category.id}=${category.name}`).join(", ");
  const first = await client.responses.create({
    model: process.env.OPENAI_CHAT_MODEL ?? "gpt-5.6-terra",
    instructions: `You are FinDex's grounded Financial Brain for mocked US/USD data. The dataset is as of ${demoData.metadata.asOfDate} in ${demoData.metadata.timezone}. Previous calendar month is ${previous.startDate} through ${previous.endDate}. Categories: ${categories}. Use a tool for every numeric claim; never calculate money yourself. Be concise, factual, and state when data is out of range. This is educational demo analysis, not financial advice.`,
    input: [...body.history.slice(-12), { role: "user" as const, content: body.message }],
    tools: financeTools,
    tool_choice: "required",
    parallel_tool_calls: false,
    max_output_tokens: 700,
  }, { signal });

  const calls = first.output.filter((item): item is Responses.ResponseFunctionToolCall => item.type === "function_call");
  if (!calls.length) {
    await emitText(controller, first.output_text || "I couldn’t ground that request in the demo ledger.");
    return;
  }

  emit(controller, { type: "status", status: "querying" });
  let requestedWidget: WidgetSpec | null = null;
  const outputs = calls.map((call) => {
    const execution = executeTool(call.name, call.arguments);
    emit(controller, { type: "tool_result", tool: call.name, summary: JSON.stringify(execution.result).slice(0, 180), provenance: execution.provenance });
    if (call.name === "request_widget") requestedWidget = createFireWidgetSpec();
    return { type: "function_call_output" as const, call_id: call.call_id, output: JSON.stringify(execution.result) };
  });

  const stream = await client.responses.create({
    model: process.env.OPENAI_CHAT_MODEL ?? "gpt-5.6-terra",
    previous_response_id: first.id,
    input: outputs,
    tools: financeTools,
    max_output_tokens: 700,
    stream: true,
  }, { signal });
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") emit(controller, { type: "text_delta", delta: event.delta });
  }

  if (requestedWidget) {
    if (state.widgets >= 3) return;
    state.widgets += 1;
    emit(controller, { type: "status", status: "sandboxing" });
    const artifact = await generateWidget(requestedWidget, signal);
    emit(controller, { type: "status", status: "rendering" });
    emit(controller, { type: "widget", artifact });
  }
}

export async function POST(request: Request) {
  const parsed = brainRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid Brain request." }, { status: 400 });
  const session = sessionFor(request);
  const state = quota.get(session.id) ?? { turns: 0, widgets: 0 };
  if (state.turns >= 25) return Response.json({ error: "This demo session has reached its 25-turn limit." }, { status: 429 });
  state.turns += 1;
  quota.set(session.id, state);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(118_000)]);
      try {
        emit(controller, { type: "status", status: "thinking" });
        const handled = await deterministicDemoResponse(parsed.data.message, controller, state, signal);
        if (!handled) await openAIResponse(parsed.data, controller, state, signal);
      } catch (error) {
        emit(controller, { type: "error", message: error instanceof Error && error.name === "TimeoutError" ? "The request timed out. You can retry safely." : "I couldn’t complete that request. Your dashboard data is unchanged.", recoverable: true });
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

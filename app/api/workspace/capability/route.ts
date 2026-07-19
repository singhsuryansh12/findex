import OpenAI from "openai";
import { z } from "zod";
import { demoData, getFilteredTransactions, getFinancialSnapshot, getForecast } from "@/lib/finance/engine";
import {
  analyzeInputSchema,
  emptyCapabilityInputSchema,
  marketSearchInputSchema,
  parseCapabilityInput,
  researchInputSchema,
  symbolInputSchema,
  timeSeriesInputSchema,
  transactionInputSchema,
} from "@/lib/workspaces/capability-inputs";
import { capabilityNameSchema } from "@/lib/workspaces/contracts";
import { workspaceModel } from "@/lib/workspaces/planner";
import { normalizeTwelveQuote, normalizeTwelveSearch, normalizeTwelveTimeSeries } from "@/lib/workspaces/providers";
import { sessionFor } from "@/lib/workspaces/session";
import { verifyArtifactSignature, verifyCapabilityToken } from "@/lib/workspaces/signing";
import { consumeCapabilityCall, type CapabilityQuotaState } from "@/lib/workspaces/quotas";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  artifactId: z.string().uuid(),
  artifactToken: z.string().min(32).max(8_000),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  artifactSignature: z.string().min(32).max(200),
  capability: capabilityNameSchema,
  input: z.unknown(),
});

type CacheEntry = { expiresAt: number; freshAt: string; value: unknown };
const cache = new Map<string, CacheEntry>();
const limits = new Map<string, CapabilityQuotaState>();

function rateLimit(sessionId: string, expensive: boolean) {
  const now = Date.now();
  const date = new Date(now).toISOString().slice(0, 10);
  const state = limits.get(sessionId) ?? { minute: [], day: date, aiCalls: 0 };
  const result = consumeCapabilityCall(state, now, expensive);
  limits.set(sessionId, state);
  return result;
}

async function cached<T>(key: string, ttlMs: number, task: () => Promise<T>) {
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return { value: existing.value as T, cached: true, stale: false, freshAt: existing.freshAt };
  try {
    const value = await task();
    const freshAt = new Date().toISOString();
    cache.set(key, { value, freshAt, expiresAt: Date.now() + ttlMs });
    return { value, cached: false, stale: false, freshAt };
  } catch (error) {
    if (existing) return { value: existing.value as T, cached: true, stale: true, freshAt: existing.freshAt };
    throw error;
  }
}

async function twelveData(endpoint: string, params: Record<string, string>) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error("Live market data is unavailable because TWELVE_DATA_API_KEY is not configured.");
  const url = new URL(`https://api.twelvedata.com/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Authorization: `apikey ${apiKey}` },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok || result.status === "error" || result.code) {
    throw new Error(typeof result.message === "string" ? result.message : `Twelve Data returned ${response.status}.`);
  }
  return result;
}

function collectCitations(value: unknown, found = new Map<string, { title: string; url: string }>()) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) collectCitations(item, found);
    return found;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.url === "string" && /^https:\/\//.test(record.url)) {
    found.set(record.url, { title: typeof record.title === "string" ? record.title : new URL(record.url).hostname, url: record.url });
  }
  for (const child of Object.values(record)) collectCitations(child, found);
  return found;
}

async function executeCapability(capability: z.infer<typeof capabilityNameSchema>, input: unknown) {
  const freshAt = new Date().toISOString();
  const ledgerFreshAt = `${demoData.metadata.asOfDate}T00:00:00.000Z`;
  if (capability === "ledger.snapshot") {
    emptyCapabilityInputSchema.parse(input);
    return { result: getFinancialSnapshot(), source: "FinDex demo ledger", freshAt: ledgerFreshAt };
  }
  if (capability === "ledger.forecast") {
    emptyCapabilityInputSchema.parse(input);
    return { result: getForecast(), source: "FinDex deterministic forecast", freshAt: ledgerFreshAt };
  }
  if (capability === "ledger.recurring") {
    emptyCapabilityInputSchema.parse(input);
    const result = demoData.recurringRules.filter((rule) => rule.active && rule.amountCents < 0)
      .map(({ name, amountCents, cadence, dayOfMonth, daysOfMonth, monthOfYear }) => ({ name, amountCents, cadence, dayOfMonth, daysOfMonth, monthOfYear }));
    return { result, source: "FinDex demo ledger", freshAt: ledgerFreshAt };
  }
  if (capability === "ledger.transactions") {
    const parsed = transactionInputSchema.parse(input);
    const result = getFilteredTransactions(parsed.categoryId ?? undefined, parsed.limit);
    return { result, source: `FinDex demo ledger · ${result.length} transactions`, freshAt: ledgerFreshAt };
  }
  if (capability === "market.search") {
    const parsed = marketSearchInputSchema.parse(input);
    const response = await cached(`search:${parsed.query.toLowerCase()}:${parsed.limit}`, 15 * 60_000, async () => normalizeTwelveSearch(await twelveData("symbol_search", { symbol: parsed.query, outputsize: String(parsed.limit) })));
    return { result: response.value, source: `Twelve Data${response.cached ? " · cached" : ""}${response.stale ? " · stale" : ""}`, freshAt: response.freshAt };
  }
  if (capability === "market.quote") {
    const parsed = symbolInputSchema.parse(input);
    const response = await cached(`quote:${parsed.symbol.toUpperCase()}`, 60_000, async () => normalizeTwelveQuote(await twelveData("quote", { symbol: parsed.symbol })));
    return { result: response.value, source: `Twelve Data${response.cached ? " · cached" : ""}${response.stale ? " · stale" : ""}`, freshAt: response.freshAt };
  }
  if (capability === "market.timeSeries") {
    const parsed = timeSeriesInputSchema.parse(input);
    const key = `series:${parsed.symbol.toUpperCase()}:${parsed.interval}:${parsed.outputsize}`;
    const response = await cached(key, 15 * 60_000, async () => normalizeTwelveTimeSeries(await twelveData("time_series", {
      symbol: parsed.symbol,
      interval: parsed.interval,
      outputsize: String(parsed.outputsize),
      timezone: "UTC",
    })));
    return { result: response.value, source: `Twelve Data${response.cached ? " · cached" : ""}${response.stale ? " · stale" : ""}`, freshAt: response.freshAt };
  }
  if (capability === "research.webSearch") {
    const parsed = researchInputSchema.parse(input);
    if (!process.env.OPENAI_API_KEY) throw new Error("Cited research is unavailable because OPENAI_API_KEY is not configured.");
    const key = `research:${JSON.stringify(parsed)}`;
    const response = await cached(key, 30 * 60_000, async () => {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      return client.responses.create({
        model: workspaceModel(),
        reasoning: { effort: "low" },
        input: `Research this financial question. Clearly distinguish sourced facts from inference, include dates, and do not provide individualized financial advice:\n${parsed.query}`,
        tools: [{
          type: "web_search",
          search_context_size: "medium",
          ...(parsed.allowedDomains.length ? { filters: { allowed_domains: parsed.allowedDomains } } : {}),
        }],
        include: ["web_search_call.action.sources"],
        max_output_tokens: 2_000,
      });
    });
    return {
      result: { text: response.value.output_text, citations: [...collectCitations(response.value.output).values()] },
      source: `OpenAI web search${response.cached ? " · cached" : ""}${response.stale ? " · stale" : ""}`,
      freshAt: response.freshAt,
    };
  }
  if (capability === "ai.analyze") {
    const parsed = analyzeInputSchema.parse(input);
    const serialized = JSON.stringify(parsed.context) ?? "null";
    if (serialized.length > 20_000) throw new Error("AI analysis context is limited to 20 KB.");
    if (!process.env.OPENAI_API_KEY) throw new Error("AI analysis is unavailable because OPENAI_API_KEY is not configured.");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: workspaceModel(),
      reasoning: { effort: parsed.depth === "standard" ? "medium" : "low" },
      instructions: "Analyze the supplied financial scenario using only the supplied context. State assumptions and uncertainty. Never claim to execute transactions or provide individualized financial advice.",
      input: `Task:\n${parsed.task}\n\nContext:\n${serialized}`,
      max_output_tokens: 1_500,
    });
    return { result: { text: response.output_text }, source: `${workspaceModel()} brokered analysis`, freshAt };
  }
  throw new Error(`${capability} is handled locally by the trusted workspace host.`);
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid capability request.", issues: parsed.error.issues }, { status: 400 });
  const session = sessionFor(request);
  const grant = verifyCapabilityToken(parsed.data.artifactToken, session.id);
  if (
    !grant
    || grant.artifactId !== parsed.data.artifactId
    || !grant.grants.includes(parsed.data.capability)
    || !verifyArtifactSignature(
      parsed.data.artifactSignature,
      session.id,
      parsed.data.artifactId,
      parsed.data.artifactHash,
      grant.grants,
    )
  ) {
    return Response.json({ error: "Capability is not granted to this workspace." }, { status: 403 });
  }
  if (["workspace.state", "file.export"].includes(parsed.data.capability)) return Response.json({ error: "This capability must be handled by the trusted browser host." }, { status: 400 });
  try {
    parseCapabilityInput(parsed.data.capability, parsed.data.input);
  } catch (error) {
    return Response.json({ error: "Invalid capability input.", issues: error instanceof z.ZodError ? error.issues : [] }, { status: 400 });
  }
  const expensive = new Set(["research.webSearch", "ai.analyze"]).has(parsed.data.capability);
  const limited = rateLimit(session.id, expensive);
  if (limited) return Response.json({ error: limited }, { status: 429 });
  try {
    const result = await executeCapability(parsed.data.capability, parsed.data.input);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Capability failed.";
    return Response.json({ ok: false, error: message }, { status: error instanceof z.ZodError ? 400 : 503 });
  }
}

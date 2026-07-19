import { z } from "zod";
import type { CapabilityName } from "./contracts";

export const emptyCapabilityInputSchema = z.object({}).strict();
export const transactionInputSchema = z.object({
  categoryId: z.string().max(40).nullable().default(null),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
export const symbolInputSchema = z.object({ symbol: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9./:_-]+$/) }).strict();
export const marketSearchInputSchema = z.object({ query: z.string().trim().min(1).max(80), limit: z.number().int().min(1).max(20).default(8) }).strict();
export const timeSeriesInputSchema = symbolInputSchema.extend({
  interval: z.enum(["1min", "5min", "15min", "30min", "1h", "4h", "1day", "1week", "1month"]),
  outputsize: z.number().int().min(2).max(200).default(60),
});
export const researchInputSchema = z.object({
  query: z.string().trim().min(3).max(500),
  allowedDomains: z.array(z.string().trim().min(3).max(120).regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i)).max(5).default([]),
}).strict();
export const analyzeInputSchema = z.object({
  task: z.string().trim().min(3).max(600),
  context: z.unknown().refine((value) => (JSON.stringify(value) ?? "null").length <= 20_000, "AI analysis context is limited to 20 KB."),
  depth: z.enum(["quick", "standard"]).default("quick"),
}).strict();
export const stateInputSchema = z.object({
  operation: z.enum(["get", "set"]),
  key: z.string().regex(/^[a-zA-Z0-9_.:-]{1,80}$/),
  value: z.unknown().optional(),
}).strict();
export const exportInputSchema = z.object({
  filename: z.string().min(1).max(100),
  data: z.unknown().refine((value) => (JSON.stringify(value) ?? "null").length <= 2_000_000, "Workspace exports are limited to 2 MB."),
  format: z.enum(["json", "csv"]),
}).strict();

const schemas: Record<CapabilityName, z.ZodType> = {
  "ledger.snapshot": emptyCapabilityInputSchema,
  "ledger.transactions": transactionInputSchema,
  "ledger.recurring": emptyCapabilityInputSchema,
  "ledger.forecast": emptyCapabilityInputSchema,
  "market.search": marketSearchInputSchema,
  "market.quote": symbolInputSchema,
  "market.timeSeries": timeSeriesInputSchema,
  "research.webSearch": researchInputSchema,
  "ai.analyze": analyzeInputSchema,
  "workspace.state": stateInputSchema,
  "file.export": exportInputSchema,
};

export function parseCapabilityInput(capability: CapabilityName, input: unknown) {
  return schemas[capability].parse(input);
}

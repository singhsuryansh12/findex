import type OpenAI from "openai";
import { APIConnectionError, APIConnectionTimeoutError } from "openai";
import type { ParsedResponse } from "openai/resources/responses/responses";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceBuildPlan } from "@/lib/workspaces/contracts";
import { calibrateInitialComplexity, enforceComplexityFloor, normalizePlanForActiveWorkspace } from "@/lib/workspaces/complexity";
import { buildPolicy, FINDEX_MODELS, planningPolicy, retryPlanningPolicy, reviewPolicy, shouldRepairWorkspaceFailure, stageDeadlines } from "@/lib/workspaces/model-policy";
import { normalizeModelError, requireParsedResponse } from "@/lib/workspaces/openai-response";
import { planWorkspace } from "@/lib/workspaces/planner";

function plan(): WorkspaceBuildPlan {
  return {
    schemaVersion: 2,
    intent: "create",
    title: "FIRE retirement planner",
    goal: "Plan financial independence with transparent assumptions",
    response: "",
    assumptions: ["4% withdrawal rate", "3% inflation"],
    inputs: [{ id: "annual_spend", label: "Annual spend", type: "currency", description: "Current annual spending", required: true, defaultValue: "60000" }],
    outputs: [{ id: "fire_number", label: "FIRE number", description: "Target portfolio", format: "USD" }],
    interactions: ["Annual spending updates the FIRE number"],
    layout: ["Responsive calculator and assumptions"],
    dataNeeds: [],
    persistence: { enabled: false, stateSchemaVersion: 1, description: "" },
    capabilities: [],
    disclosures: ["Educational information only; not financial advice."],
    acceptanceCriteria: ["Changing annual spending updates the target"],
    clarificationQuestions: [],
  };
}

function response<T>(overrides: Partial<ParsedResponse<T>>): ParsedResponse<T> {
  return {
    id: "resp_test",
    status: "completed",
    output: [],
    output_parsed: null,
    incomplete_details: null,
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    ...overrides,
  } as unknown as ParsedResponse<T>;
}

afterEach(() => vi.restoreAllMocks());

describe("Findex model routing", () => {
  it("routes standard FIRE work through Terra and reserves Sol for review or repair", () => {
    expect(planningPolicy("standard")).toEqual({ model: FINDEX_MODELS.terra, effort: "medium", maxOutputTokens: 12_000 });
    expect(buildPolicy("standard")).toEqual({ model: FINDEX_MODELS.terra, effort: "medium", maxOutputTokens: 32_000 });
    expect(reviewPolicy("standard")).toMatchObject({ model: FINDEX_MODELS.sol, effort: "low" });
    expect(buildPolicy("standard", true)).toMatchObject({ model: FINDEX_MODELS.sol, effort: "medium" });
    expect(buildPolicy("complex", true)).toMatchObject({ model: FINDEX_MODELS.sol, effort: "high" });
    expect(calibrateInitialComplexity(
      { level: "complex", riskFlags: ["sensitive_math"], rationale: "Several linked calculations" },
      "Build a FIRE calculator for me to plan my retirement.",
      false,
    )).toMatchObject({ level: "standard", riskFlags: [] });
    expect(calibrateInitialComplexity(
      { level: "complex", riskFlags: ["sensitive_math"], rationale: "Monte Carlo and tax work" },
      "Build a FIRE planner with Monte Carlo simulation and capital gains tax optimization.",
      false,
    ).level).toBe("complex");
    expect(calibrateInitialComplexity(
      { level: "complex", riskFlags: ["state_migration"], rationale: "Active revision" },
      "Revise my FIRE calculator.",
      true,
    ).level).toBe("complex");
    const persistentFirePlan = { ...plan(), persistence: { enabled: true, stateSchemaVersion: 1, description: "Save one calculator scenario" }, capabilities: ["workspace.state"] as WorkspaceBuildPlan["capabilities"] };
    expect(enforceComplexityFloor({ level: "standard", riskFlags: [], rationale: "Retirement calculator" }, persistentFirePlan)).toMatchObject({
      level: "standard",
      riskFlags: ["persistence"],
    });
    const detailedFirePlan: WorkspaceBuildPlan = {
      ...persistentFirePlan,
      goal: "Estimate a target portfolio, projected time to financial independence, and retirement-income sustainability.",
      inputs: Array.from({ length: 10 }, (_, index) => ({
        id: `input_${index}`,
        label: `Assumption ${index + 1}`,
        type: "number" as const,
        description: "Editable retirement assumption",
        required: true,
        defaultValue: "1",
      })),
      interactions: Array.from({ length: 8 }, (_, index) => `Assumption ${index + 1} updates the projection`),
      layout: ["Header", "Assumption controls", "Summary row", "Portfolio projection chart", "Projection table", "Methodology footer"],
      acceptanceCriteria: ["The portfolio projection updates when retirement assumptions change"],
    };
    expect(enforceComplexityFloor({ level: "standard", riskFlags: [], rationale: "Retirement calculator" }, detailedFirePlan)).toMatchObject({
      level: "standard",
      riskFlags: ["persistence", "rich_interaction"],
    });
    const safetyExplicitFirePlan: WorkspaceBuildPlan = {
      ...detailedFirePlan,
      acceptanceCriteria: [
        "The workspace contains no live market data, account access, trading, money movement, or personalized advice.",
      ],
      disclosures: ["No trading or money movement. Educational information only; not financial advice."],
    };
    expect(enforceComplexityFloor({ level: "standard", riskFlags: [], rationale: "Retirement calculator" }, safetyExplicitFirePlan)).toMatchObject({
      level: "standard",
      riskFlags: ["persistence", "rich_interaction"],
    });
  });

  it("normalizes a degenerate FIRE spending default before generation while preserving explicit zero intent", () => {
    const zeroSpendingPlan: WorkspaceBuildPlan = {
      ...plan(),
      inputs: plan().inputs.map((input) => ({ ...input, defaultValue: "0" })),
    };
    const normalized = normalizePlanForActiveWorkspace(zeroSpendingPlan, null, "Build a FIRE calculator for retirement planning.");
    expect(normalized.inputs[0]?.defaultValue).toBe("60000");
    expect(normalized.assumptions.at(-1)).toContain("Illustrative annual retirement spending starts at 60,000");
    const explicitZero = normalizePlanForActiveWorkspace(zeroSpendingPlan, null, "Build a FIRE calculator assuming zero retirement spending.");
    expect(explicitZero.inputs[0]?.defaultValue).toBe("0");
  });

  it("uses capacity retry for token exhaustion, semantic Sol repair only for ordinary plans, and no timeout/refusal escalation", () => {
    expect(retryPlanningPolicy("standard", "PLAN_TOKEN_LIMIT")).toEqual({ model: FINDEX_MODELS.terra, effort: "medium", maxOutputTokens: 24_000 });
    expect(retryPlanningPolicy("standard", "PLAN_INVALID")).toEqual({ model: FINDEX_MODELS.sol, effort: "medium", maxOutputTokens: 16_000 });
    expect(retryPlanningPolicy("standard", "MODEL_TRANSIENT")).toEqual({ model: FINDEX_MODELS.terra, effort: "medium", maxOutputTokens: 12_000 });
    expect(retryPlanningPolicy("complex", "PLAN_INVALID")).toBeNull();
    expect(retryPlanningPolicy("standard", "PLAN_TIMEOUT")).toBeNull();
    expect(retryPlanningPolicy("standard", "PLAN_REFUSED")).toBeNull();
    expect(shouldRepairWorkspaceFailure("source_validation")).toBe(true);
    expect(shouldRepairWorkspaceFailure("semantic_review")).toBe(true);
    expect(shouldRepairWorkspaceFailure("provider_or_platform")).toBe(false);
  });

  it("keeps independent deadlines below one Function invocation and the durable run at twenty minutes", () => {
    expect(stageDeadlines.assessmentMs).toBe(30_000);
    expect(stageDeadlines.planningAttemptMs).toBe(90_000);
    expect(stageDeadlines.standardBuildMs).toBe(240_000);
    expect(stageDeadlines.validationMs).toBe(210_000);
    expect(stageDeadlines.reviewMs).toBe(90_000);
    expect(stageDeadlines.workflowMs).toBe(1_200_000);
  });
});

describe("structured response classification", () => {
  it("classifies token exhaustion and refusals without exposing provider output", () => {
    expect(() => requireParsedResponse(response({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }), "plan"))
      .toThrowError(expect.objectContaining({ code: "PLAN_TOKEN_LIMIT" }));
    expect(() => requireParsedResponse(response({ output: [{ type: "message", content: [{ type: "refusal", refusal: "raw private refusal" }] }] as never }), "plan"))
      .toThrowError(expect.objectContaining({ code: "PLAN_REFUSED", message: expect.not.stringContaining("raw private refusal") }));
  });

  it("returns a parsed object only for a completed structured response", () => {
    const parsed = plan();
    expect(requireParsedResponse(response({ output_parsed: parsed }), "plan")).toEqual(parsed);
    expect(() => requireParsedResponse(response({ status: "incomplete", output_parsed: parsed, incomplete_details: { reason: "max_output_tokens" } }), "plan"))
      .toThrowError(expect.objectContaining({ code: "PLAN_TOKEN_LIMIT" }));
  });

  it("classifies SDK exceptions without exposing provider messages", () => {
    const connection = normalizeModelError(new APIConnectionError({
      message: "secret upstream detail",
      cause: new Error("socket reset with credential"),
    }), "workspace plan");
    expect(connection).toMatchObject({
      code: "MODEL_TRANSIENT",
      message: expect.not.stringContaining("secret"),
      metadata: { retryable: true, providerErrorClass: "APIConnectionError" },
    });
    expect(normalizeModelError(new APIConnectionTimeoutError(), "workspace plan")).toMatchObject({
      code: "PLAN_TIMEOUT",
      metadata: { providerErrorClass: "APIConnectionTimeoutError" },
    });
    expect(normalizeModelError(Object.assign(new Error("length"), { name: "LengthFinishReasonError" }), "workspace plan"))
      .toMatchObject({ code: "PLAN_TOKEN_LIMIT", metadata: { retryable: true } });
    expect(normalizeModelError(Object.assign(new Error("filtered"), { name: "ContentFilterFinishReasonError" }), "workspace plan"))
      .toMatchObject({ code: "PLAN_REFUSED" });
    expect(normalizeModelError(Object.assign(new Error("invalid private output"), { name: "ZodError" }), "workspace plan"))
      .toMatchObject({ code: "PLAN_INVALID", message: expect.not.stringContaining("private") });
  });
});

describe("planning retry behavior", () => {
  it("retries an incomplete Terra plan once with the higher cap", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const parse = vi.fn()
      .mockResolvedValueOnce(response<WorkspaceBuildPlan>({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }))
      .mockResolvedValueOnce(response({ id: "resp_success", output_parsed: plan() }));
    const client = { responses: { parse } } as unknown as OpenAI;
    const result = await planWorkspace(client, {
      prompt: "Build a FIRE calculator for me to plan my retirement.", active: null,
      clarificationAnswers: [], clarificationRoundComplete: false,
      assessment: { level: "standard", riskFlags: [], rationale: "Editable retirement assumptions" },
      requestId: "request-test",
    });
    expect(result.plan.title).toBe("FIRE retirement planner");
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls[0]?.[0]).toMatchObject({ model: FINDEX_MODELS.terra, max_output_tokens: 12_000 });
    expect(parse.mock.calls[0]?.[0]?.instructions).toContain("do not add scenario comparison, sensitivity analysis");
    expect(parse.mock.calls[1]?.[0]).toMatchObject({ model: FINDEX_MODELS.terra, max_output_tokens: 24_000 });
  });

  it("does not retry a refusal", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const parse = vi.fn().mockResolvedValue(response<WorkspaceBuildPlan>({ output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] as never }));
    const client = { responses: { parse } } as unknown as OpenAI;
    await expect(planWorkspace(client, {
      prompt: "Build an unsafe tool", active: null, clarificationAnswers: [], clarificationRoundComplete: false,
      assessment: { level: "standard", riskFlags: ["security"], rationale: "Unsafe" }, requestId: "request-refusal",
    })).rejects.toMatchObject({ code: "PLAN_REFUSED" });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("retries one transient connection failure on Terra without increasing capacity", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const parse = vi.fn()
      .mockRejectedValueOnce(new APIConnectionError({ message: "temporary connection failure", cause: new Error("ECONNRESET") }))
      .mockResolvedValueOnce(response({ id: "resp_success", output_parsed: plan() }));
    const client = { responses: { parse } } as unknown as OpenAI;
    const result = await planWorkspace(client, {
      prompt: "Build a FIRE calculator for me to plan my retirement.", active: null,
      clarificationAnswers: [], clarificationRoundComplete: false,
      assessment: { level: "standard", riskFlags: [], rationale: "Editable retirement assumptions" },
      requestId: "request-transient",
    });
    expect(result.plan.title).toBe("FIRE retirement planner");
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls[0]?.[0]).toMatchObject({ model: FINDEX_MODELS.terra, max_output_tokens: 12_000 });
    expect(parse.mock.calls[1]?.[0]).toMatchObject({ model: FINDEX_MODELS.terra, max_output_tokens: 12_000 });
  });

  it("uses the single Sol semantic retry for a structured parser failure", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const parse = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("invalid generated object"), { name: "ZodError" }))
      .mockResolvedValueOnce(response({ id: "resp_success", output_parsed: plan() }));
    const client = { responses: { parse } } as unknown as OpenAI;
    await planWorkspace(client, {
      prompt: "Build a FIRE calculator for me to plan my retirement.", active: null,
      clarificationAnswers: [], clarificationRoundComplete: false,
      assessment: { level: "standard", riskFlags: [], rationale: "Editable retirement assumptions" },
      requestId: "request-invalid",
    });
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls[1]?.[0]).toMatchObject({ model: FINDEX_MODELS.sol, max_output_tokens: 16_000 });
  });
});

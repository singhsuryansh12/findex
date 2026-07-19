import OpenAI from "openai";
import { getWritable } from "workflow";
import type { BrainEvent } from "@/lib/brain/contracts";
import type { ActiveWorkspaceContext, BuildComplexityAssessment, ModelStageTrace, WorkspaceArtifactV2, WorkspaceBuildPlan, WorkspaceFile, WorkspaceReview, WorkspaceTokenUsage } from "@/lib/workspaces/contracts";
import type { WorkspaceBuildDraft, WorkspaceSandboxValidation } from "@/lib/workspaces/generator";
import { shouldRepairWorkspaceFailure } from "@/lib/workspaces/model-policy";
import { canRepairWorkspaceValidation, validationFailureFrom, type WorkspaceValidationCode } from "@/lib/workspaces/validation-errors";

export type FinancialWorkspaceWorkflowInput = {
  requestId: string;
  prompt: string;
  plan: WorkspaceBuildPlan;
  assessment: BuildComplexityAssessment;
  active: ActiveWorkspaceContext | null;
  sessionId: string;
  initialUsage: WorkspaceTokenUsage;
  initialTimings: { assessmentMs: number; planningMs: number };
  initialTraces: ModelStageTrace[];
  deadlineAt: number;
};

export type FinancialWorkspaceWorkflowResult =
  | { status: "completed"; artifact: WorkspaceArtifactV2 }
  | { status: "failed"; message: string };

type ValidationStepResult =
  | { ok: true; validation: WorkspaceSandboxValidation; durationMs: number }
  | { ok: false; code: WorkspaceValidationCode; diagnostics: string[]; durationMs: number; repairable: boolean; platformTransient: boolean };

type ReviewStepResult =
  | { ok: true; review: WorkspaceReview; usage: WorkspaceTokenUsage; durationMs: number; trace: ModelStageTrace }
  | { ok: false; diagnostics: string[]; durationMs: number; repairable: boolean; usage?: WorkspaceTokenUsage; trace?: ModelStageTrace };

function safeFailureMessage(error: unknown) {
  if (error instanceof Error && error.message.startsWith("Findex")) return error.message.slice(0, 600);
  return "Findex couldn't finish this workspace; nothing was published.";
}

function assertWithinDeadline(deadlineAt: number) {
  if (Date.now() >= deadlineAt) throw new Error("Findex couldn't finish this workspace within the build window; nothing was published.");
}

function deadlineSignal(deadlineAt: number) {
  return AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()));
}

async function buildStep(
  input: FinancialWorkspaceWorkflowInput,
  files: WorkspaceFile[],
  repair: boolean,
  diagnostics: string[],
): Promise<WorkspaceBuildDraft> {
  "use step";
  console.log(JSON.stringify({ event: "findex_workflow_step", requestId: input.requestId, stage: repair ? "repair" : "building", state: "start" }));
  assertWithinDeadline(input.deadlineAt);
  const writer = getWritable<BrainEvent>().getWriter();
  try {
    await writer.write({
      type: "build_progress",
      phase: repair ? "repairing" : "coding",
      detail: repair ? "Findex is repairing the measured findings" : "Findex is building your workspace",
      complexity: input.assessment.level,
    });
  } finally {
    writer.releaseLock();
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  const { buildWorkspaceDraft, scaffoldWorkspaceFiles } = await import("@/lib/workspaces/generator");
  const result = await buildWorkspaceDraft({
    client,
    plan: input.plan,
    assessment: input.assessment,
    active: input.active,
    files: files.length ? files : scaffoldWorkspaceFiles(input.active),
    repair,
    diagnostics,
    requestId: input.requestId,
    signal: deadlineSignal(input.deadlineAt),
  });
  console.log(JSON.stringify({ event: "findex_workflow_step", requestId: input.requestId, stage: repair ? "repair" : "building", state: "done", durationMs: result.durationMs }));
  return result;
}
buildStep.maxRetries = 0;

async function validationStep(input: FinancialWorkspaceWorkflowInput, files: WorkspaceFile[]): Promise<ValidationStepResult> {
  "use step";
  console.log(JSON.stringify({ event: "findex_workflow_step", requestId: input.requestId, stage: "validation", state: "start" }));
  assertWithinDeadline(input.deadlineAt);
  const writer = getWritable<BrainEvent>().getWriter();
  try {
    await writer.write({ type: "build_progress", phase: "checking", detail: "Findex is checking the build", complexity: input.assessment.level });
    await writer.write({ type: "build_progress", phase: "browser_testing", detail: "Findex is verifying interactions and responsive behavior", complexity: input.assessment.level });
  } finally {
    writer.releaseLock();
  }
  const startedAt = Date.now();
  try {
    const { validateWorkspaceDraft } = await import("@/lib/workspaces/generator");
    const result = await validateWorkspaceDraft({ files, assessment: input.assessment, plan: input.plan, signal: deadlineSignal(input.deadlineAt) });
    console.log(JSON.stringify({ event: "findex_workflow_step", requestId: input.requestId, stage: "validation", state: "done", durationMs: result.durationMs }));
    return { ok: true, ...result };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const failure = validationFailureFrom(error);
    const repairable = canRepairWorkspaceValidation(failure)
      && shouldRepairWorkspaceFailure(failure.platformTransient ? "provider_or_platform" : "source_validation");
    console.warn(JSON.stringify({
      event: "findex_workflow_step",
      requestId: input.requestId,
      stage: "validation",
      state: "failed",
      durationMs,
      code: failure.code,
      actionable: failure.actionable,
      platformTransient: failure.platformTransient,
    }));
    return { ok: false, ...failure, durationMs, repairable };
  }
}
validationStep.maxRetries = 0;

async function reviewStep(
  input: FinancialWorkspaceWorkflowInput,
  files: WorkspaceFile[],
  validation: WorkspaceSandboxValidation | null,
  attempt: number,
): Promise<ReviewStepResult> {
  "use step";
  console.log(JSON.stringify({ event: "findex_workflow_step", requestId: input.requestId, stage: "review", state: "start", attempt }));
  assertWithinDeadline(input.deadlineAt);
  const writer = getWritable<BrainEvent>().getWriter();
  try {
    await writer.write({ type: "build_progress", phase: "reviewing", detail: "Findex is independently reviewing the workspace", complexity: input.assessment.level });
  } finally {
    writer.releaseLock();
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  const startedAt = Date.now();
  try {
    const { reviewWorkspaceDraft } = await import("@/lib/workspaces/generator");
    const reviewed = await reviewWorkspaceDraft({
      client,
      plan: input.plan,
      assessment: input.assessment,
      files,
      screenshots: validation?.screenshots,
      requestId: input.requestId,
      attempt,
      signal: deadlineSignal(input.deadlineAt),
    });
    if (!reviewed.review.passed || reviewed.review.score < 90 || reviewed.review.acceptanceResults.some((result) => !result.passed)) {
      return {
        ok: false,
        diagnostics: reviewed.review.issues.length ? reviewed.review.issues : [`Independent review scored ${reviewed.review.score}/100.`],
        durationMs: reviewed.durationMs,
        repairable: shouldRepairWorkspaceFailure("semantic_review"),
        usage: reviewed.usage,
        trace: reviewed.trace,
      };
    }
    console.log(JSON.stringify({ event: "findex_workflow_step", requestId: input.requestId, stage: "review", state: "done", attempt, durationMs: reviewed.durationMs }));
    return { ok: true, ...reviewed };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.warn(JSON.stringify({ event: "findex_workflow_step", requestId: input.requestId, stage: "review", state: "failed", attempt, durationMs }));
    return { ok: false, diagnostics: [error instanceof Error ? error.message.slice(0, 2_000) : "Independent review failed."], durationMs, repairable: shouldRepairWorkspaceFailure("provider_or_platform") };
  }
}
reviewStep.maxRetries = 0;

async function publishStep(options: {
  input: FinancialWorkspaceWorkflowInput;
  draft: WorkspaceBuildDraft;
  validation: WorkspaceSandboxValidation;
  review: WorkspaceReview;
  buildUsage: WorkspaceTokenUsage;
  reviewUsage: WorkspaceTokenUsage;
  codingMs: number;
  validationMs: number;
  reviewMs: number;
  repairCount: number;
  traces: ModelStageTrace[];
}): Promise<WorkspaceArtifactV2> {
  "use step";
  console.log(JSON.stringify({ event: "findex_workflow_step", requestId: options.input.requestId, stage: "publishing", state: "start" }));
  assertWithinDeadline(options.input.deadlineAt);
  const { publishWorkspaceArtifact } = await import("@/lib/workspaces/generator");
  const artifact = publishWorkspaceArtifact({
    prompt: options.input.prompt,
    plan: options.input.plan,
    assessment: options.input.assessment,
    active: options.input.active,
    sessionId: options.input.sessionId,
    files: options.draft.files,
    sandboxValidation: options.validation,
    review: options.review,
    model: options.draft.model,
    effort: options.draft.effort,
    initialUsage: options.input.initialUsage,
    buildUsage: options.buildUsage,
    reviewUsage: options.reviewUsage,
    initialTimings: options.input.initialTimings,
    codingMs: options.codingMs,
    validationMs: options.validationMs,
    reviewMs: options.reviewMs,
    repairCount: options.repairCount,
    stageTraces: options.traces,
  });
  const writer = getWritable<BrainEvent>().getWriter();
  try {
    await writer.write({ type: "build_progress", phase: "publishing", detail: "Findex is publishing a verified version", complexity: options.input.assessment.level });
    await writer.write({ type: "workspace_published", artifact });
  } finally {
    writer.releaseLock();
  }
  console.log(JSON.stringify({ event: "findex_workflow_step", requestId: options.input.requestId, stage: "publishing", state: "done", repairCount: options.repairCount }));
  return artifact;
}
publishStep.maxRetries = 0;

async function failureStep(requestId: string, message: string): Promise<void> {
  "use step";
  console.warn(JSON.stringify({ event: "findex_workflow_terminal", requestId, result: "failed" }));
  const writer = getWritable<BrainEvent>().getWriter();
  try {
    await writer.write({ type: "workspace_failed", message, recoverable: true, code: "WORKFLOW_FAILED" });
  } finally {
    writer.releaseLock();
  }
}
failureStep.maxRetries = 0;

function plusUsage(first: WorkspaceTokenUsage, second: WorkspaceTokenUsage): WorkspaceTokenUsage {
  return {
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    totalTokens: first.totalTokens + second.totalTokens,
  };
}

export async function financialWorkspaceWorkflow(input: FinancialWorkspaceWorkflowInput): Promise<FinancialWorkspaceWorkflowResult> {
  "use workflow";
  console.log(JSON.stringify({ event: "findex_workflow_terminal", requestId: input.requestId, result: "started" }));
  try {
    let files = input.active?.files.map((file) => ({ ...file })) ?? [];
    let buildUsage: WorkspaceTokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let reviewUsage: WorkspaceTokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let codingMs = 0;
    let validationMs = 0;
    let reviewMs = 0;
    const traces = [...input.initialTraces];

    let draft = await buildStep(input, files, false, []);
    files = draft.files;
    buildUsage = plusUsage(buildUsage, draft.usage);
    codingMs += draft.durationMs;
    traces.push(draft.trace);

    let checked = await validationStep(input, files);
    validationMs += checked.durationMs;
    let reviewed: ReviewStepResult | null = null;
    let diagnostics = checked.ok ? [] : checked.diagnostics;
    if (!checked.ok && !checked.repairable) {
      if (checked.platformTransient) throw new Error("Findex couldn't complete sandbox validation because the local runner or platform remained unavailable; nothing was published.");
      throw new Error(`Findex couldn't safely repair this workspace because validation returned no actionable diagnostics (${checked.code}); nothing was published.`);
    }
    // Review the source even when deterministic validation fails. This lets the
    // single repair pass address browser findings and financial/accessibility
    // defects together instead of discovering semantic defects after the only
    // allowed repair has already been spent.
    reviewed = await reviewStep(input, files, checked.ok ? checked.validation : null, 1);
    reviewMs += reviewed.durationMs;
    if (reviewed.usage) reviewUsage = plusUsage(reviewUsage, reviewed.usage);
    if (reviewed.trace) traces.push(reviewed.trace);
    if (!reviewed.ok && reviewed.repairable) diagnostics = [...diagnostics, ...reviewed.diagnostics];
    if (checked.ok && !reviewed.ok && !reviewed.repairable) throw new Error("Findex couldn't complete the independent review; nothing was published.");

    let repairCount = 0;
    if (!checked.ok || !reviewed?.ok) {
      repairCount = 1;
      draft = await buildStep(input, files, true, diagnostics);
      files = draft.files;
      buildUsage = plusUsage(buildUsage, draft.usage);
      codingMs += draft.durationMs;
      traces.push(draft.trace);
      checked = await validationStep(input, files);
      validationMs += checked.durationMs;
      if (!checked.ok) throw new Error(`Findex couldn't validate the repaired workspace (${checked.code}); nothing was published.`);
      reviewed = await reviewStep(input, files, checked.validation, 2);
      reviewMs += reviewed.durationMs;
      if (reviewed.usage) reviewUsage = plusUsage(reviewUsage, reviewed.usage);
      if (reviewed.trace) traces.push(reviewed.trace);
      if (!reviewed.ok) throw new Error("Findex couldn't approve the repaired workspace; nothing was published.");
    }

    if (!checked.ok || !reviewed?.ok) throw new Error("Findex couldn't finish this workspace; nothing was published.");
    const artifact = await publishStep({
      input, draft, validation: checked.validation, review: reviewed.review,
      buildUsage, reviewUsage, codingMs, validationMs, reviewMs, repairCount, traces,
    });
    console.log(JSON.stringify({ event: "findex_workflow_terminal", requestId: input.requestId, result: "completed", repairCount }));
    return { status: "completed", artifact };
  } catch (error) {
    const message = safeFailureMessage(error);
    await failureStep(input.requestId, message);
    console.log(JSON.stringify({ event: "findex_workflow_terminal", requestId: input.requestId, result: "failed" }));
    return { status: "failed", message };
  }
}

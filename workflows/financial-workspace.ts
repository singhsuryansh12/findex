import OpenAI from "openai";
import { getWritable } from "workflow";
import type { BrainEvent } from "@/lib/brain/contracts";
import type { ActiveWorkspaceContext, BuildComplexityAssessment, ModelStageTrace, WorkspaceArtifactV2, WorkspaceBuildPlan, WorkspaceFile, WorkspaceReview, WorkspaceTokenUsage } from "@/lib/workspaces/contracts";
import type { WorkspaceBuildDraft, WorkspaceSandboxValidation } from "@/lib/workspaces/generator";
import { shouldRepairWorkspaceFailure } from "@/lib/workspaces/model-policy";
import { WorkspaceModelError, type WorkspaceModelErrorCode } from "@/lib/workspaces/openai-response";
import { classifyPolishDiagnostics, summarizeUpgradeOffer } from "@/lib/workspaces/polish-classify";
import { canRepairWorkspaceValidation, validationFailureFrom, type WorkspaceValidationCode } from "@/lib/workspaces/validation-errors";
import { buildFailureMessage, safeFailureMessage } from "@/lib/workspaces/workflow-failures";

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

type BuildStepResult =
  | { ok: true; draft: WorkspaceBuildDraft }
  | { ok: false; message: string; code?: WorkspaceModelErrorCode; durationMs: number };

type ValidationStepResult =
  | { ok: true; validation: WorkspaceSandboxValidation; durationMs: number }
  | { ok: false; code: WorkspaceValidationCode; diagnostics: string[]; durationMs: number; repairable: boolean; platformTransient: boolean };

type ReviewStepResult =
  | { ok: true; review: WorkspaceReview; usage: WorkspaceTokenUsage; durationMs: number; trace: ModelStageTrace }
  | { ok: false; diagnostics: string[]; durationMs: number; repairable: boolean; usage?: WorkspaceTokenUsage; trace?: ModelStageTrace };

type DraftPublishResult =
  | { ok: true; artifact: WorkspaceArtifactV2 }
  | { ok: false; reason: string };

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
): Promise<BuildStepResult> {
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
  const startedAt = Date.now();
  try {
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
    return { ok: true, draft: result };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = buildFailureMessage(error);
    const code = error instanceof WorkspaceModelError ? error.code : undefined;
    console.warn(JSON.stringify({
      event: "findex_workflow_step",
      requestId: input.requestId,
      stage: repair ? "repair" : "building",
      state: "failed",
      durationMs,
      code,
    }));
    return { ok: false, message, code, durationMs };
  }
}
buildStep.maxRetries = 0;

async function publishDraftStep(options: {
  input: FinancialWorkspaceWorkflowInput;
  draft: WorkspaceBuildDraft;
  buildUsage: WorkspaceTokenUsage;
  codingMs: number;
  traces: ModelStageTrace[];
  activeBase: ActiveWorkspaceContext | null;
  versionBump: number;
  event: "workspace_published" | "workspace_refined";
  validation?: WorkspaceSandboxValidation;
}): Promise<DraftPublishResult> {
  "use step";
  console.log(JSON.stringify({ event: "findex_workflow_step", requestId: options.input.requestId, stage: "publishing", state: "start", qualityTier: "draft" }));
  assertWithinDeadline(options.input.deadlineAt);
  try {
    const { publishWorkspaceArtifact } = await import("@/lib/workspaces/generator");
    const { bundleWorkspaceResilient } = await import("@/lib/workspaces/sandbox");
    const bundle = options.validation?.bundle ?? await bundleWorkspaceResilient(options.draft.files);
    const checks = options.validation?.checks ?? [
      { name: "Host preflight", passed: true, detail: "Source passed policy and preflight before draft publish." },
    ];
    const artifact = publishWorkspaceArtifact({
      prompt: options.input.prompt,
      plan: options.input.plan,
      assessment: options.input.assessment,
      active: options.activeBase,
      sessionId: options.input.sessionId,
      files: options.draft.files,
      sandboxValidation: { bundle, checks, executor: options.validation?.executor },
      qualityTier: "draft",
      model: options.draft.model,
      effort: options.draft.effort,
      initialUsage: options.input.initialUsage,
      buildUsage: options.buildUsage,
      reviewUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      initialTimings: options.input.initialTimings,
      codingMs: options.codingMs,
      validationMs: 0,
      reviewMs: 0,
      repairCount: 0,
      stageTraces: options.traces,
      versionBump: options.versionBump,
    });
    const writer = getWritable<BrainEvent>().getWriter();
    try {
      await writer.write({
        type: "build_progress",
        phase: "publishing",
        detail: options.event === "workspace_refined"
          ? "Findex applied a safe polish to your draft"
          : "Findex published a working draft you can use now",
        complexity: options.input.assessment.level,
      });
      if (options.event === "workspace_refined") {
        await writer.write({ type: "workspace_refined", artifact, reason: "safe_polish" });
      } else {
        await writer.write({ type: "workspace_published", artifact });
      }
    } finally {
      writer.releaseLock();
    }
    console.log(JSON.stringify({ event: "findex_workflow_step", requestId: options.input.requestId, stage: "publishing", state: "done", qualityTier: "draft" }));
    return { ok: true, artifact };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 400) : "Draft bundle failed.";
    console.warn(JSON.stringify({ event: "findex_workflow_step", requestId: options.input.requestId, stage: "publishing", state: "skipped", qualityTier: "draft", reason }));
    return { ok: false, reason };
  }
}
publishDraftStep.maxRetries = 0;

async function validationStep(input: FinancialWorkspaceWorkflowInput, files: WorkspaceFile[]): Promise<ValidationStepResult> {
  "use step";
  console.log(JSON.stringify({ event: "findex_workflow_step", requestId: input.requestId, stage: "validation", state: "start" }));
  assertWithinDeadline(input.deadlineAt);
  const writer = getWritable<BrainEvent>().getWriter();
  try {
    await writer.write({ type: "build_progress", phase: "checking", detail: "Findex is refining the draft in the background", complexity: input.assessment.level });
    await writer.write({ type: "build_progress", phase: "browser_testing", detail: "Findex is verifying interactions in the background", complexity: input.assessment.level });
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
      diagnosticCount: failure.diagnostics.length,
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
    await writer.write({ type: "build_progress", phase: "reviewing", detail: "Findex is independently reviewing the draft", complexity: input.assessment.level });
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
      hostChecks: validation?.checks,
      requestId: input.requestId,
      attempt,
      signal: deadlineSignal(input.deadlineAt),
    });
    if (!reviewed.review.passed || reviewed.review.score < 90 || reviewed.review.acceptanceResults.some((result) => !result.passed)) {
      const failedAcceptance = reviewed.review.acceptanceResults
        .filter((result) => !result.passed)
        .map((result) => result.criterion)
        .slice(0, 4);
      return {
        ok: false,
        diagnostics: [
          ...(reviewed.review.issues.length ? reviewed.review.issues : [`Independent review scored ${reviewed.review.score}/100.`]),
          ...failedAcceptance.map((criterion) => `Acceptance criterion failed: ${criterion}`),
        ],
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

async function publishVerifiedStep(options: {
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
  activeBase: ActiveWorkspaceContext | null;
  versionBump: number;
  asRefine: boolean;
}): Promise<WorkspaceArtifactV2> {
  "use step";
  console.log(JSON.stringify({ event: "findex_workflow_step", requestId: options.input.requestId, stage: "publishing", state: "start", qualityTier: "verified" }));
  assertWithinDeadline(options.input.deadlineAt);
  const { publishWorkspaceArtifact } = await import("@/lib/workspaces/generator");
  const artifact = publishWorkspaceArtifact({
    prompt: options.input.prompt,
    plan: options.input.plan,
    assessment: options.input.assessment,
    active: options.activeBase,
    sessionId: options.input.sessionId,
    files: options.draft.files,
    sandboxValidation: options.validation,
    review: options.review,
    qualityTier: "verified",
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
    versionBump: options.versionBump,
  });
  const writer = getWritable<BrainEvent>().getWriter();
  try {
    await writer.write({
      type: "build_progress",
      phase: "publishing",
      detail: options.asRefine ? "Findex verified a polished version" : "Findex is publishing a verified version",
      complexity: options.input.assessment.level,
    });
    if (options.asRefine) {
      await writer.write({ type: "workspace_refined", artifact, reason: "safe_polish" });
    } else {
      await writer.write({ type: "workspace_published", artifact });
    }
  } finally {
    writer.releaseLock();
  }
  console.log(JSON.stringify({ event: "findex_workflow_step", requestId: options.input.requestId, stage: "publishing", state: "done", qualityTier: "verified", repairCount: options.repairCount }));
  return artifact;
}
publishVerifiedStep.maxRetries = 0;

async function offerUpgradeStep(requestId: string, diagnostics: string[], candidateVersionId: string): Promise<void> {
  "use step";
  const { summary, changes } = summarizeUpgradeOffer(diagnostics);
  const writer = getWritable<BrainEvent>().getWriter();
  try {
    await writer.write({ type: "workspace_upgrade_offer", summary, changes, candidateVersionId });
  } finally {
    writer.releaseLock();
  }
  console.log(JSON.stringify({ event: "findex_workflow_step", requestId, stage: "review", state: "offer", candidateVersionId }));
}
offerUpgradeStep.maxRetries = 0;

async function softBackgroundNoteStep(requestId: string, detail: string): Promise<void> {
  "use step";
  const writer = getWritable<BrainEvent>().getWriter();
  try {
    await writer.write({
      type: "assistant_delta",
      delta: ` ${detail}`,
    });
  } finally {
    writer.releaseLock();
  }
  console.log(JSON.stringify({ event: "findex_workflow_step", requestId, stage: "validation", state: "soft_fail" }));
}
softBackgroundNoteStep.maxRetries = 0;

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

function activeFromArtifact(artifact: WorkspaceArtifactV2): ActiveWorkspaceContext {
  return {
    projectId: artifact.projectId,
    versionId: artifact.id,
    version: artifact.version,
    title: artifact.title,
    plan: artifact.plan,
    files: artifact.files,
    manifest: artifact.manifest,
    validation: artifact.validation,
  };
}

export async function financialWorkspaceWorkflow(input: FinancialWorkspaceWorkflowInput): Promise<FinancialWorkspaceWorkflowResult> {
  "use workflow";
  console.log(JSON.stringify({ event: "findex_workflow_terminal", requestId: input.requestId, result: "started" }));
  let publishedDraft: WorkspaceArtifactV2 | null = null;
  try {
    let files = input.active?.files.map((file) => ({ ...file })) ?? [];
    let buildUsage: WorkspaceTokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let reviewUsage: WorkspaceTokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let codingMs = 0;
    let validationMs = 0;
    let reviewMs = 0;
    const traces = [...input.initialTraces];
    let versionBump = 1;
    let activeBase: ActiveWorkspaceContext | null = input.active;

    const built = await buildStep(input, files, false, []);
    if (!built.ok) {
      await failureStep(input.requestId, built.message);
      console.log(JSON.stringify({ event: "findex_workflow_terminal", requestId: input.requestId, result: "failed", code: built.code }));
      return { status: "failed", message: built.message };
    }
    let draft = built.draft;
    files = draft.files;
    buildUsage = plusUsage(buildUsage, draft.usage);
    codingMs += draft.durationMs;
    traces.push(draft.trace);

    const earlyDraft = await publishDraftStep({
      input,
      draft,
      buildUsage,
      codingMs,
      traces,
      activeBase,
      versionBump,
      event: "workspace_published",
    });
    if (earlyDraft.ok) {
      publishedDraft = earlyDraft.artifact;
      activeBase = activeFromArtifact(earlyDraft.artifact);
      versionBump = 1;
    }

    let checked = await validationStep(input, files);
    validationMs += checked.durationMs;

    if (!publishedDraft && checked.ok) {
      const lateDraft = await publishDraftStep({
        input,
        draft,
        buildUsage,
        codingMs,
        traces,
        activeBase,
        versionBump,
        event: "workspace_published",
        validation: checked.validation,
      });
      if (lateDraft.ok) {
        publishedDraft = lateDraft.artifact;
        activeBase = activeFromArtifact(lateDraft.artifact);
        versionBump = 1;
      }
    }

    let reviewed: ReviewStepResult | null = null;
    let diagnostics = checked.ok ? [] : checked.diagnostics;

    if (!checked.ok && !checked.repairable) {
      if (publishedDraft) {
        await softBackgroundNoteStep(
          input.requestId,
          "Background validation could not finish, but your draft is still available—tell me what to improve.",
        );
        console.log(JSON.stringify({ event: "findex_workflow_terminal", requestId: input.requestId, result: "completed", qualityTier: "draft" }));
        return { status: "completed", artifact: publishedDraft };
      }
      if (checked.platformTransient) throw new Error("Findex couldn't complete sandbox validation because the local runner or platform remained unavailable; nothing was published.");
      throw new Error(`Findex couldn't safely repair this workspace because validation returned no actionable diagnostics (${checked.code}); nothing was published.`);
    }

    if (checked.ok) {
      reviewed = await reviewStep(input, files, checked.validation, 1);
      reviewMs += reviewed.durationMs;
      if (reviewed.usage) reviewUsage = plusUsage(reviewUsage, reviewed.usage);
      if (reviewed.trace) traces.push(reviewed.trace);
      if (!reviewed.ok && reviewed.repairable) diagnostics = [...diagnostics, ...reviewed.diagnostics];
      if (!reviewed.ok && !reviewed.repairable) {
        if (!publishedDraft) {
          const rescueDraft = await publishDraftStep({
            input,
            draft,
            buildUsage,
            codingMs,
            traces,
            activeBase,
            versionBump,
            event: "workspace_published",
            validation: checked.validation,
          });
          if (rescueDraft.ok) {
            publishedDraft = rescueDraft.artifact;
            activeBase = activeFromArtifact(rescueDraft.artifact);
            versionBump = 1;
          }
        }
        if (publishedDraft) {
          await softBackgroundNoteStep(input.requestId, "Background review could not finish; your draft stays usable. Tell me what to change.");
          return { status: "completed", artifact: publishedDraft };
        }
        throw new Error("Findex couldn't complete the independent review; nothing was published.");
      }
    }

    let repairCount = 0;
    if (!checked.ok || !reviewed?.ok) {
      const classification = classifyPolishDiagnostics(diagnostics);
      if (publishedDraft && classification === "behavior_offer") {
        await offerUpgradeStep(input.requestId, diagnostics, publishedDraft.id);
        console.log(JSON.stringify({ event: "findex_workflow_terminal", requestId: input.requestId, result: "completed", qualityTier: "draft", offer: true }));
        return { status: "completed", artifact: publishedDraft };
      }

      repairCount = 1;
      const repaired = await buildStep(input, files, true, diagnostics);
      if (!repaired.ok) {
        if (publishedDraft) {
          await softBackgroundNoteStep(input.requestId, "A background repair did not land; your draft is unchanged. Tell me what to tweak.");
          return { status: "completed", artifact: publishedDraft };
        }
        await failureStep(input.requestId, repaired.message);
        console.log(JSON.stringify({ event: "findex_workflow_terminal", requestId: input.requestId, result: "failed", code: repaired.code }));
        return { status: "failed", message: repaired.message };
      }
      draft = repaired.draft;
      files = draft.files;
      buildUsage = plusUsage(buildUsage, draft.usage);
      codingMs += draft.durationMs;
      traces.push(draft.trace);
      checked = await validationStep(input, files);
      validationMs += checked.durationMs;
      if (!checked.ok) {
        if (publishedDraft) {
          await softBackgroundNoteStep(input.requestId, "Background polish could not be validated; your draft is unchanged.");
          return { status: "completed", artifact: publishedDraft };
        }
        throw new Error(`Findex couldn't validate the repaired workspace (${checked.code}); nothing was published.`);
      }
      // Post-repair validation succeeded — publish a usable draft before review can hard-fail.
      if (!publishedDraft) {
        const postRepairDraft = await publishDraftStep({
          input,
          draft,
          buildUsage,
          codingMs,
          traces,
          activeBase,
          versionBump,
          event: "workspace_published",
          validation: checked.validation,
        });
        if (postRepairDraft.ok) {
          publishedDraft = postRepairDraft.artifact;
          activeBase = activeFromArtifact(postRepairDraft.artifact);
          versionBump = 1;
        }
      }
      reviewed = await reviewStep(input, files, checked.validation, 2);
      reviewMs += reviewed.durationMs;
      if (reviewed.usage) reviewUsage = plusUsage(reviewUsage, reviewed.usage);
      if (reviewed.trace) traces.push(reviewed.trace);
      if (!reviewed.ok) {
        if (!publishedDraft) {
          const rescueDraft = await publishDraftStep({
            input,
            draft,
            buildUsage,
            codingMs,
            traces,
            activeBase,
            versionBump,
            event: "workspace_published",
            validation: checked.validation,
          });
          if (rescueDraft.ok) {
            publishedDraft = rescueDraft.artifact;
            activeBase = activeFromArtifact(rescueDraft.artifact);
            versionBump = 1;
          }
        }
        if (publishedDraft) {
          if (classifyPolishDiagnostics(reviewed.diagnostics) === "behavior_offer") {
            await offerUpgradeStep(input.requestId, reviewed.diagnostics, publishedDraft.id);
          } else {
            await softBackgroundNoteStep(input.requestId, "Background polish did not fully verify; your draft stays usable.");
          }
          return { status: "completed", artifact: publishedDraft };
        }
        const detail = reviewed.diagnostics.slice(0, 2).join(" ").trim();
        throw new Error(`Findex couldn't approve the repaired workspace; nothing was published.${detail ? ` ${detail}` : ""}`.slice(0, 600));
      }

      if (publishedDraft && classification === "safe_polish") {
        const refined = await publishVerifiedStep({
          input,
          draft,
          validation: checked.validation,
          review: reviewed.review,
          buildUsage,
          reviewUsage,
          codingMs,
          validationMs,
          reviewMs,
          repairCount,
          traces,
          activeBase,
          versionBump,
          asRefine: true,
        });
        console.log(JSON.stringify({ event: "findex_workflow_terminal", requestId: input.requestId, result: "completed", qualityTier: "verified", repairCount }));
        return { status: "completed", artifact: refined };
      }
    }

    if (!checked.ok || !reviewed?.ok) {
      if (publishedDraft) {
        await softBackgroundNoteStep(input.requestId, "Background refinement stopped early; your draft is still available.");
        return { status: "completed", artifact: publishedDraft };
      }
      throw new Error("Findex couldn't finish this workspace; nothing was published.");
    }

    const artifact = await publishVerifiedStep({
      input,
      draft,
      validation: checked.validation,
      review: reviewed.review,
      buildUsage,
      reviewUsage,
      codingMs,
      validationMs,
      reviewMs,
      repairCount,
      traces,
      activeBase,
      versionBump,
      asRefine: Boolean(publishedDraft),
    });
    console.log(JSON.stringify({ event: "findex_workflow_terminal", requestId: input.requestId, result: "completed", repairCount, qualityTier: "verified" }));
    return { status: "completed", artifact };
  } catch (error) {
    if (publishedDraft) {
      await softBackgroundNoteStep(input.requestId, "Background refinement hit a snag; your draft is still available—tell me what to improve.");
      console.log(JSON.stringify({ event: "findex_workflow_terminal", requestId: input.requestId, result: "completed", qualityTier: "draft", soft: true }));
      return { status: "completed", artifact: publishedDraft };
    }
    const message = safeFailureMessage(error);
    await failureStep(input.requestId, message);
    console.log(JSON.stringify({ event: "findex_workflow_terminal", requestId: input.requestId, result: "failed" }));
    return { status: "failed", message };
  }
}

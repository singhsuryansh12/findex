import { z } from "zod";

export const buildComplexityLevelSchema = z.enum(["simple", "standard", "complex"]);
export type BuildComplexityLevel = z.infer<typeof buildComplexityLevelSchema>;

export const reasoningEffortSchema = z.enum(["low", "medium", "high"]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const buildRiskFlagSchema = z.enum([
  "live_data",
  "runtime_ai",
  "persistence",
  "state_migration",
  "multi_view",
  "sensitive_math",
  "export",
  "security",
]);

export const buildComplexityAssessmentSchema = z.object({
  level: buildComplexityLevelSchema,
  riskFlags: z.array(buildRiskFlagSchema).max(8),
  rationale: z.string().min(1).max(500),
});
export type BuildComplexityAssessment = z.infer<typeof buildComplexityAssessmentSchema>;

export const capabilityNameSchema = z.enum([
  "ledger.snapshot",
  "ledger.transactions",
  "ledger.recurring",
  "ledger.forecast",
  "ledger.portfolio",
  "ledger.cashflow",
  "market.search",
  "market.quote",
  "market.timeSeries",
  "research.webSearch",
  "ai.analyze",
  "workspace.state",
  "file.export",
]);
export type CapabilityName = z.infer<typeof capabilityNameSchema>;

export const capabilityGrantSchema = z.object({
  artifactId: z.string().uuid(),
  grants: z.array(capabilityNameSchema).max(13),
  expiresAt: z.number().int().positive(),
});
export type CapabilityGrant = z.infer<typeof capabilityGrantSchema>;

export const workspacePlanInputSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  label: z.string().min(1).max(80),
  type: z.enum(["number", "currency", "percentage", "text", "select", "date", "boolean"]),
  description: z.string().max(240),
  required: z.boolean(),
  defaultValue: z.string().max(120),
});

export const workspacePlanOutputSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  label: z.string().min(1).max(80),
  description: z.string().max(240),
  format: z.string().min(1).max(80),
});

export const workspaceBuildPlanSchema = z.object({
  schemaVersion: z.literal(2),
  intent: z.enum(["answer", "clarify", "create", "revise"]),
  title: z.string().min(3).max(80),
  goal: z.string().min(3).max(500),
  response: z.string().max(1_500),
  assumptions: z.array(z.string().min(1).max(240)).max(12),
  inputs: z.array(workspacePlanInputSchema).max(20),
  outputs: z.array(workspacePlanOutputSchema).max(20),
  interactions: z.array(z.string().min(1).max(240)).max(20),
  layout: z.array(z.string().min(1).max(240)).max(12),
  dataNeeds: z.array(z.string().min(1).max(240)).max(12),
  persistence: z.object({
    enabled: z.boolean(),
    stateSchemaVersion: z.number().int().min(1).max(100),
    description: z.string().max(240),
  }),
  capabilities: z.array(capabilityNameSchema).max(13),
  disclosures: z.array(z.string().min(1).max(240)).max(8),
  acceptanceCriteria: z.array(z.string().min(1).max(240)).min(1).max(20),
  clarificationQuestions: z.array(z.string().min(3).max(240)).max(3),
});
export type WorkspaceBuildPlan = z.infer<typeof workspaceBuildPlanSchema>;

export const workspaceFileSchema = z.object({
  path: z.string().min(1).max(160),
  content: z.string().max(256_000),
});
export type WorkspaceFile = z.infer<typeof workspaceFileSchema>;

export const workspaceValidationCheckSchema = z.object({
  name: z.string().min(1).max(80),
  passed: z.boolean(),
  detail: z.string().max(4_000),
});

export const workspaceReviewSchema = z.object({
  passed: z.boolean(),
  score: z.number().int().min(0).max(100),
  issues: z.array(z.string().max(500)).max(20),
  strengths: z.array(z.string().max(500)).max(12),
  acceptanceResults: z.array(z.object({
    criterion: z.string().max(240),
    passed: z.boolean(),
    detail: z.string().max(500),
  })).max(20),
});
export type WorkspaceReview = z.infer<typeof workspaceReviewSchema>;

export const workspaceValidationReportSchema = z.object({
  passed: z.boolean(),
  checks: z.array(workspaceValidationCheckSchema).min(1),
  issues: z.array(z.string().max(4_000)),
  review: workspaceReviewSchema,
});
export type WorkspaceValidationReport = z.infer<typeof workspaceValidationReportSchema>;

export const workspaceManifestSchema = z.object({
  schemaVersion: z.literal(2),
  entry: z.literal("src/App.tsx"),
  capabilities: z.array(capabilityNameSchema),
  stateSchemaVersion: z.number().int().min(1).max(100),
  allowedImports: z.array(z.string()),
  sourceBytes: z.number().int().nonnegative(),
  bundleBytes: z.number().int().nonnegative(),
});
export type WorkspaceManifest = z.infer<typeof workspaceManifestSchema>;

export const workspaceTokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export const workspaceArtifactSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  version: z.number().int().min(1),
  parentVersionId: z.string().uuid().nullable(),
  restoredFromVersionId: z.string().uuid().nullable(),
  title: z.string().min(3).max(80),
  prompt: z.string().min(1).max(1_000),
  plan: workspaceBuildPlanSchema,
  files: z.array(workspaceFileSchema).min(1).max(80),
  bundle: z.object({
    javascript: z.string().max(2_000_000),
    css: z.string().max(2_000_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  manifest: workspaceManifestSchema,
  validation: workspaceValidationReportSchema,
  model: z.literal("gpt-5.6-sol"),
  effort: reasoningEffortSchema,
  complexity: buildComplexityAssessmentSchema,
  effortEscalations: z.array(reasoningEffortSchema).max(3),
  tokenUsage: workspaceTokenUsageSchema,
  timings: z.object({
    assessmentMs: z.number().int().nonnegative(),
    planningMs: z.number().int().nonnegative(),
    codingMs: z.number().int().nonnegative(),
    validationMs: z.number().int().nonnegative(),
    reviewMs: z.number().int().nonnegative(),
    totalMs: z.number().int().nonnegative(),
  }),
  durationMs: z.number().int().nonnegative(),
  repairCount: z.number().int().min(0).max(2),
  generatedAt: z.string().datetime(),
  provenance: z.string().min(1).max(500),
  capabilityToken: z.string().min(32).max(8_000),
  artifactSignature: z.string().min(32).max(200),
}).superRefine((artifact, context) => {
  const sourceBytes = artifact.files.reduce((total, file) => total + new TextEncoder().encode(file.content).length, 0);
  const bundleBytes = new TextEncoder().encode(artifact.bundle.javascript).length + new TextEncoder().encode(artifact.bundle.css).length;
  if (sourceBytes > 256_000) context.addIssue({ code: "custom", path: ["files"], message: "Artifact source exceeds 256 KB." });
  if (bundleBytes > 2_000_000) context.addIssue({ code: "custom", path: ["bundle"], message: "Artifact bundle exceeds 2 MB." });
  if (artifact.manifest.sourceBytes !== sourceBytes || artifact.manifest.bundleBytes !== bundleBytes) {
    context.addIssue({ code: "custom", path: ["manifest"], message: "Artifact manifest byte counts do not match its content." });
  }
  if ([...artifact.plan.capabilities].sort().join("\0") !== [...artifact.manifest.capabilities].sort().join("\0")) {
    context.addIssue({ code: "custom", path: ["manifest", "capabilities"], message: "Artifact capabilities do not match its plan." });
  }
  if (artifact.plan.persistence.stateSchemaVersion !== artifact.manifest.stateSchemaVersion) {
    context.addIssue({ code: "custom", path: ["manifest", "stateSchemaVersion"], message: "Artifact state schema does not match its plan." });
  }
  if (!artifact.validation.passed || artifact.validation.checks.some((check) => !check.passed) || !artifact.validation.review.passed || artifact.validation.review.score < 90) {
    context.addIssue({ code: "custom", path: ["validation"], message: "Only fully validated artifacts may be persisted." });
  }
});
export type WorkspaceArtifactV2 = z.infer<typeof workspaceArtifactSchema>;

export const activeWorkspaceContextSchema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
  version: z.number().int().min(1),
  title: z.string().min(3).max(80),
  plan: workspaceBuildPlanSchema,
  files: z.array(workspaceFileSchema).min(1).max(80),
  manifest: workspaceManifestSchema,
  validation: workspaceValidationReportSchema,
}).superRefine((value, context) => {
  const sourceBytes = value.files.reduce((total, file) => total + new TextEncoder().encode(file.content).length, 0);
  if (sourceBytes > 256_000) context.addIssue({ code: "custom", path: ["files"], message: "Active workspace source exceeds 256 KB." });
});
export type ActiveWorkspaceContext = z.infer<typeof activeWorkspaceContextSchema>;

export type WorkspaceProject = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeVersionId: string;
};

export type WorkspaceProgressPhase =
  | "assessing"
  | "planning"
  | "clarifying"
  | "scaffolding"
  | "coding"
  | "checking"
  | "browser_testing"
  | "reviewing"
  | "repairing"
  | "publishing";

export const ALLOWED_WORKSPACE_IMPORTS = [
  "react",
  "react-dom",
  "react-dom/client",
  "recharts",
  "lucide-react",
  "date-fns",
  "@findex/workspace-sdk",
] as const;

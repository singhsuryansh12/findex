import { z } from "zod";
import type { WorkspaceArtifactV2, WorkspaceProgressPhase } from "@/lib/workspaces/contracts";
import { activeWorkspaceContextSchema, buildComplexityLevelSchema } from "@/lib/workspaces/contracts";

export const brainRequestSchema = z.object({
  message: z.string().trim().min(1).max(1_000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(2_000),
  })).max(24).default([]),
  activeWorkspace: activeWorkspaceContextSchema.nullable().default(null),
  clarificationToken: z.string().max(8_000).nullable().default(null),
  clarificationAnswers: z.array(z.string().trim().min(1).max(1_000)).max(3).default([]),
});

export type BrainRequest = z.infer<typeof brainRequestSchema>;

export type BrainEvent =
  | { type: "assistant_delta"; delta: string }
  | {
    type: "build_progress";
    phase: WorkspaceProgressPhase;
    detail: string;
    complexity?: z.infer<typeof buildComplexityLevelSchema>;
  }
  | { type: "tool_result"; tool: string; summary: string; provenance: string }
  | { type: "clarification_required"; questions: string[]; token: string; planTitle: string }
  | { type: "workspace_published"; artifact: WorkspaceArtifactV2 }
  | { type: "workspace_failed"; message: string; recoverable: boolean }
  | { type: "error"; message: string; recoverable: boolean };

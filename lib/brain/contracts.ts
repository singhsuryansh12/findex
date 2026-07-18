import { z } from "zod";
import type { WidgetArtifact } from "@/lib/widgets/contracts";

export const brainRequestSchema = z.object({
  sessionId: z.string().min(8).max(80),
  message: z.string().trim().min(1).max(500),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(1_500),
  })).max(24).default([]),
});

export type BrainRequest = z.infer<typeof brainRequestSchema>;
export type BrainStatus = "thinking" | "querying" | "sandboxing" | "coding" | "validating" | "rendering";

export type BrainEvent =
  | { type: "status"; status: BrainStatus; detail?: string }
  | { type: "text_delta"; delta: string }
  | { type: "tool_result"; tool: string; summary: string; provenance: string }
  | { type: "widget"; artifact: WidgetArtifact }
  | { type: "error"; message: string; recoverable: boolean };

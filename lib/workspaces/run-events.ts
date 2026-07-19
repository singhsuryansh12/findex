import type { BrainEvent } from "@/lib/brain/contracts";

export function parseRunStartIndex(value: string | null) {
  const parsed = Number(value ?? "0");
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function encodeRunEvent(event: BrainEvent, index: number) {
  return `id: ${index}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function isTerminalRunStatus(status: string) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

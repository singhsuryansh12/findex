import type { BrainEvent } from "@/lib/brain/contracts";
import { authorizedRun } from "@/lib/workspaces/run-access";
import { encodeRunEvent, parseRunStartIndex } from "@/lib/workspaces/run-events";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ runId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { runId } = await params;
  const access = await authorizedRun(request, runId);
  if ("response" in access) return access.response;
  const startIndex = parseRunStartIndex(new URL(request.url).searchParams.get("startIndex"));
  const readable = access.run.getReadable<BrainEvent>({ startIndex });
  const tailIndex = await readable.getTailIndex();
  const encoder = new TextEncoder();
  let index = startIndex;
  const stream = readable.pipeThrough(new TransformStream<BrainEvent, Uint8Array>({
    transform(event, controller) {
      controller.enqueue(encoder.encode(encodeRunEvent(event, index)));
      index += 1;
    },
  }));
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-workflow-tail-index": String(tailIndex),
    },
  });
}

import { authorizedRun } from "@/lib/workspaces/run-access";
import { isTerminalRunStatus } from "@/lib/workspaces/run-events";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ runId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { runId } = await params;
  const access = await authorizedRun(request, runId);
  if ("response" in access) return access.response;
  const status = await access.run.status;
  if (isTerminalRunStatus(status)) return Response.json({ runId, status });
  await access.run.cancel();
  console.info(JSON.stringify({ event: "findex_workflow_cancelled", runId }));
  return Response.json({ runId, status: "cancelled" });
}

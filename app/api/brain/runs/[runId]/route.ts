import { authorizedRun } from "@/lib/workspaces/run-access";
import type { FinancialWorkspaceWorkflowResult } from "@/workflows/financial-workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ runId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { runId } = await params;
  const access = await authorizedRun(request, runId);
  if ("response" in access) return access.response;
  const [status, createdAt, startedAt, completedAt] = await Promise.all([
    access.run.status,
    access.run.createdAt,
    access.run.startedAt,
    access.run.completedAt,
  ]);
  let returnValue: FinancialWorkspaceWorkflowResult | null = null;
  if (status === "completed") returnValue = await access.run.returnValue as FinancialWorkspaceWorkflowResult;
  return Response.json({
    runId,
    status,
    createdAt: createdAt.toISOString(),
    startedAt: startedAt?.toISOString() ?? null,
    completedAt: completedAt?.toISOString() ?? null,
    returnValue,
  });
}

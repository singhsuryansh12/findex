import "server-only";

import { getRun } from "workflow/api";
import { sessionFor } from "./session";
import { verifyRunAccessToken } from "./signing";

export async function authorizedRun(request: Request, runId: string) {
  const session = sessionFor(request);
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!token || !verifyRunAccessToken(token, session.id, runId)) {
    return { response: Response.json({ error: "This build run is unavailable." }, { status: 403 }) } as const;
  }
  const run = getRun(runId);
  if (!(await run.exists)) {
    return { response: Response.json({ error: "Build run not found." }, { status: 404 }) } as const;
  }
  return { run } as const;
}

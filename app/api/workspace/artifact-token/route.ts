import { z } from "zod";
import { sessionFor } from "@/lib/workspaces/session";
import { signArtifactSignature, signCapabilityToken, verifyCapabilityToken } from "@/lib/workspaces/signing";

const requestSchema = z.object({
  sourceToken: z.string().min(32).max(8_000),
  artifactId: z.string().uuid(),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid artifact-token request." }, { status: 400 });
  const session = sessionFor(request);
  const source = verifyCapabilityToken(parsed.data.sourceToken, session.id);
  if (!source) return Response.json({ error: "The source artifact grant is invalid or expired." }, { status: 403 });
  return Response.json({
    token: signCapabilityToken(session.id, parsed.data.artifactId, source.grants),
    signature: signArtifactSignature(session.id, parsed.data.artifactId, parsed.data.artifactHash, source.grants),
  });
}

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { capabilityNameSchema, type CapabilityGrant, type CapabilityName } from "./contracts";

type CapabilityTokenPayload = CapabilityGrant & {
  type: "capability";
  sessionId: string;
};

type ClarificationTokenPayload = {
  type: "clarification";
  sessionId: string;
  originalPrompt: string;
  activeProjectId: string | null;
  expiresAt: number;
};

type RunTokenPayload = {
  type: "run";
  sessionId: string;
  runId: string;
  expiresAt: number;
};

function secret() {
  const configured = process.env.DEMO_SESSION_SECRET;
  if (configured) {
    if (process.env.NODE_ENV === "production" && configured.length < 32) throw new Error("DEMO_SESSION_SECRET must be at least 32 characters in production.");
    return configured;
  }
  if (process.env.NODE_ENV === "production") throw new Error("DEMO_SESSION_SECRET is required in production.");
  return "local-findex-workspace-signing-secret";
}

function encode(payload: CapabilityTokenPayload | ClarificationTokenPayload | RunTokenPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function artifactSignatureBody(sessionId: string, artifactId: string, bundleSha256: string, grants: CapabilityName[]) {
  return JSON.stringify({ sessionId, artifactId, bundleSha256, grants: [...grants].sort() });
}

export function signArtifactSignature(
  sessionId: string,
  artifactId: string,
  bundleSha256: string,
  grants: CapabilityName[],
) {
  return createHmac("sha256", secret()).update(artifactSignatureBody(sessionId, artifactId, bundleSha256, grants)).digest("base64url");
}

export function verifyArtifactSignature(
  signature: string,
  sessionId: string,
  artifactId: string,
  bundleSha256: string,
  grants: CapabilityName[],
) {
  const expected = signArtifactSignature(sessionId, artifactId, bundleSha256, grants);
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

function decode(token: string): CapabilityTokenPayload | ClarificationTokenPayload | RunTokenPayload | null {
  const [body, provided] = token.split(".");
  if (!body || !provided) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CapabilityTokenPayload | ClarificationTokenPayload | RunTokenPayload;
    if (!parsed.expiresAt || parsed.expiresAt <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function signCapabilityToken(sessionId: string, artifactId: string, grants: CapabilityName[]) {
  return encode({ type: "capability", sessionId, artifactId, grants, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1_000 });
}

export function verifyCapabilityToken(token: string, sessionId: string) {
  const payload = decode(token);
  if (!payload || payload.type !== "capability" || payload.sessionId !== sessionId) return null;
  const grants = capabilityNameSchema.array().safeParse(payload.grants);
  return grants.success ? { ...payload, grants: grants.data } : null;
}

export function signClarificationToken(sessionId: string, originalPrompt: string, activeProjectId: string | null) {
  return encode({
    type: "clarification",
    sessionId,
    originalPrompt,
    activeProjectId,
    expiresAt: Date.now() + 20 * 60 * 1_000,
  });
}

export function verifyClarificationToken(token: string, sessionId: string) {
  const payload = decode(token);
  return payload?.type === "clarification" && payload.sessionId === sessionId ? payload : null;
}

export function signRunAccessToken(sessionId: string, runId: string) {
  return encode({ type: "run", sessionId, runId, expiresAt: Date.now() + 30 * 60 * 1_000 });
}

export function verifyRunAccessToken(token: string, sessionId: string, runId: string) {
  const payload = decode(token);
  return payload?.type === "run" && payload.sessionId === sessionId && payload.runId === runId ? payload : null;
}

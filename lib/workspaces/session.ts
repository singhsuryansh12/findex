import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const COOKIE = "findex_demo_session";

function sessionSecret() {
  const configured = process.env.DEMO_SESSION_SECRET;
  if (configured) {
    if (process.env.NODE_ENV === "production" && configured.length < 32) throw new Error("DEMO_SESSION_SECRET must be at least 32 characters in production.");
    return configured;
  }
  if (process.env.NODE_ENV === "production") throw new Error("DEMO_SESSION_SECRET is required in production.");
  return "local-findex-demo-session-secret";
}

function sign(id: string) {
  return createHmac("sha256", sessionSecret()).update(id).digest("base64url");
}

export function sessionFor(request: Request) {
  const raw = request.headers.get("cookie")?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (raw) {
    const [id, provided] = raw.split(".");
    if (id && provided) {
      const expected = sign(id);
      const left = Buffer.from(expected);
      const right = Buffer.from(provided);
      if (left.length === right.length && timingSafeEqual(left, right)) return { id, cookie: null };
    }
  }
  const id = randomUUID();
  const attributes = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return {
    id,
    cookie: `${COOKIE}=${id}.${sign(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${attributes}`,
  };
}

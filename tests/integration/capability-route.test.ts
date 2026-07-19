import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as brainPost } from "@/app/api/brain/route";
import { POST as capabilityPost } from "@/app/api/workspace/capability/route";
import { POST as tokenPost } from "@/app/api/workspace/artifact-token/route";
import { signArtifactSignature, signCapabilityToken } from "@/lib/workspaces/signing";

const artifactHash = "a".repeat(64);

function signedCapability(sessionId: string, artifactId: string, grants: Parameters<typeof signCapabilityToken>[2]) {
  return {
    artifactToken: signCapabilityToken(sessionId, artifactId, grants),
    artifactHash,
    artifactSignature: signArtifactSignature(sessionId, artifactId, artifactHash, grants),
  };
}

async function sessionCookie() {
  const response = await brainPost(new Request("http://localhost/api/brain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Dining last month?", history: [] }),
  }));
  const cookie = response.headers.get("set-cookie")!;
  const pair = cookie.split(";")[0];
  const sessionId = pair.split("=")[1].split(".")[0];
  return { pair, sessionId };
}

describe("workspace capability broker", () => {
  beforeEach(() => vi.stubEnv("OPENAI_API_KEY", ""));

  it("returns a granted deterministic ledger snapshot", async () => {
    const session = await sessionCookie();
    const artifactId = crypto.randomUUID();
    const response = await capabilityPost(new Request("http://localhost/api/workspace/capability", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session.pair },
      body: JSON.stringify({
        artifactId,
        ...signedCapability(session.sessionId, artifactId, ["ledger.snapshot"]),
        capability: "ledger.snapshot",
        input: {},
      }),
    }));
    expect(response.status).toBe(200);
    const payload = await response.json() as { ok: boolean; source: string; result: { netWorthCents: number } };
    expect(payload).toMatchObject({ ok: true, source: "Findex demo ledger" });
    expect(payload.result.netWorthCents).toBeGreaterThan(0);
  });

  it("brokers least-privilege portfolio and cash-flow data", async () => {
    const session = await sessionCookie();
    const artifactId = crypto.randomUUID();
    const grants = ["ledger.portfolio", "ledger.cashflow"] as const;
    const signed = signedCapability(session.sessionId, artifactId, [...grants]);
    const portfolio = await capabilityPost(new Request("http://localhost/api/workspace/capability", {
      method: "POST", headers: { "content-type": "application/json", cookie: session.pair },
      body: JSON.stringify({ artifactId, ...signed, capability: "ledger.portfolio", input: {} }),
    }));
    expect(portfolio.status).toBe(200);
    await expect(portfolio.json()).resolves.toMatchObject({ ok: true, result: { investedCents: 14_545_000 } });

    const cashflow = await capabilityPost(new Request("http://localhost/api/workspace/capability", {
      method: "POST", headers: { "content-type": "application/json", cookie: session.pair },
      body: JSON.stringify({ artifactId, ...signed, capability: "ledger.cashflow", input: { days: "60" } }),
    }));
    expect(cashflow.status).toBe(200);
    await expect(cashflow.json()).resolves.toMatchObject({ ok: true, result: { days: 60, monthlyTakeHomeCents: 656_000 } });
  });

  it("blocks an ungranted capability and artifact-token reuse", async () => {
    const session = await sessionCookie();
    const artifactId = crypto.randomUUID();
    const signed = signedCapability(session.sessionId, artifactId, ["ledger.snapshot"]);
    const ungranted = await capabilityPost(new Request("http://localhost/api/workspace/capability", {
      method: "POST", headers: { "content-type": "application/json", cookie: session.pair },
      body: JSON.stringify({ artifactId, ...signed, capability: "market.quote", input: { symbol: "AAPL" } }),
    }));
    expect(ungranted.status).toBe(403);
    const reused = await capabilityPost(new Request("http://localhost/api/workspace/capability", {
      method: "POST", headers: { "content-type": "application/json", cookie: session.pair },
      body: JSON.stringify({ artifactId: crypto.randomUUID(), ...signed, capability: "ledger.snapshot", input: {} }),
    }));
    expect(reused.status).toBe(403);
    const tampered = await capabilityPost(new Request("http://localhost/api/workspace/capability", {
      method: "POST", headers: { "content-type": "application/json", cookie: session.pair },
      body: JSON.stringify({ artifactId, ...signed, artifactHash: "b".repeat(64), capability: "ledger.snapshot", input: {} }),
    }));
    expect(tampered.status).toBe(403);
  });

  it("fails live market data explicitly when the provider key is absent", async () => {
    vi.stubEnv("TWELVE_DATA_API_KEY", "");
    const session = await sessionCookie();
    const artifactId = crypto.randomUUID();
    const response = await capabilityPost(new Request("http://localhost/api/workspace/capability", {
      method: "POST", headers: { "content-type": "application/json", cookie: session.pair },
      body: JSON.stringify({
        artifactId,
        ...signedCapability(session.sessionId, artifactId, ["market.quote"]),
        capability: "market.quote",
        input: { symbol: "AAPL" },
      }),
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: expect.stringContaining("TWELVE_DATA_API_KEY") });
  });

  it("reissues the same bounded grants for duplicate and restored artifacts", async () => {
    const session = await sessionCookie();
    const sourceId = crypto.randomUUID();
    const nextId = crypto.randomUUID();
    const sourceToken = signCapabilityToken(session.sessionId, sourceId, ["ledger.snapshot"]);
    const refreshed = await tokenPost(new Request("http://localhost/api/workspace/artifact-token", {
      method: "POST", headers: { "content-type": "application/json", cookie: session.pair },
      body: JSON.stringify({ sourceToken, artifactId: nextId, artifactHash }),
    }));
    expect(refreshed.status).toBe(200);
    const { token, signature } = await refreshed.json() as { token: string; signature: string };
    const capability = await capabilityPost(new Request("http://localhost/api/workspace/capability", {
      method: "POST", headers: { "content-type": "application/json", cookie: session.pair },
      body: JSON.stringify({ artifactId: nextId, artifactToken: token, artifactHash, artifactSignature: signature, capability: "ledger.snapshot", input: {} }),
    }));
    expect(capability.status).toBe(200);
  });
});

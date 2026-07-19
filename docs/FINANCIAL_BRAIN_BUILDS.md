# Financial Brain workspace builds

This document is the operational source of truth for Findex's generative workspace pipeline. The host owns model selection, retry limits, validation, and publication. User prompts and generated source cannot change these policies.

## Request routing

`POST /api/brain` first routes a turn as either an ordinary financial question or a workspace request. The router recognizes explicit build verbs, workspace nouns, active-workspace revisions, and signed clarification continuations; it does not select a calculator or widget type.

Workspace requests pass through a low-cost complexity assessment. If assessment is unavailable, Findex conservatively uses `standard`. A typical editable FIRE calculator is `standard`; live market/research data, runtime AI, portfolio or tax logic, state migration, or several coordinated views can raise a request to `complex`.

## Model and deadline policy

| Stage | Simple or standard | Complex | Output cap | Deadline |
| --- | --- | --- | --- | --- |
| Financial Q&A | Terra, low | Terra, low | Tool-loop bounded | 60s |
| Complexity assessment | Terra, low | Terra, low | 800 | 30s |
| Planning, first attempt | Terra, medium | Sol, medium | 12K / 16K | 90s |
| Planning capacity retry | Terra, medium | Sol, medium | 24K | 90s |
| Initial build | Terra, medium | Sol, medium | 32K per turn | 180s simple; 240s standard/complex |
| Targeted repair | Sol, medium | Sol, high | 32K per turn | Same as build class |
| Sandbox validation | Deterministic host validator | Deterministic host validator | N/A | 210s |
| Independent review | Sol, low | Sol, medium | 12K | 90s |

The initial Brain request has a 210-second ceiling and the route retains a 300-second platform limit. After planning, generation continues in a durable Workflow run with a 20-minute overall deadline. Every paid SDK call disables invisible retries.

## Bounded failure handling

- Planning permits at most two paid attempts. Token exhaustion retries with a larger output cap. A completed but semantically invalid simple/standard plan may retry once with Sol/medium. Explicit refusal, content filtering, and timeout do not escalate reasoning.
- Transient provider failures may receive one explicit same-policy planning retry. Assessment failure does not spend another request; it falls back to `standard`.
- Workspace generation permits one initial build and at most one targeted repair. Source-validation and semantic-review diagnostics are combined before that repair.
- Every source-generation turn requires a bounded file, check, or finish tool call. A completed text-only response is a contract failure, and Findex records its response ID, status, and usage without logging the response body.
- A build pass may retry one request with the same model, effort, output cap, and remaining deadline only after an explicit connection, 408/409/429, or 5xx transient. It never raises reasoning for provider capacity errors, and a second transient ends the pass.
- Validation retries once only for a sandbox or platform transient. Source, policy, interaction, accessibility, or financial defects are never treated as platform transients.
- Publication requires deterministic validation plus an independent review score of at least 90 with every acceptance criterion passing. Failure or cancellation leaves the previously published workspace unchanged.

Typed provider classification preserves response status, response ID, incomplete reason, latency, and token usage. Stable user-safe codes include `PLAN_TOKEN_LIMIT`, `PLAN_REFUSED`, `PLAN_TIMEOUT`, `PLAN_INVALID`, `MODEL_TRANSIENT`, and `MODEL_FAILED`; raw provider output is never shown to the user.

## Durable run interface

The initial Brain stream emits `workspace_started { runId, accessToken }`. The access token is HMAC-signed against both the anonymous session and exact run ID and is sent only in the authorization header.

- `GET /api/brain/runs/[runId]/events?startIndex=N` resumes indexed progress without replaying consumed events.
- `GET /api/brain/runs/[runId]` returns status and the completed Workflow `returnValue`, allowing publication recovery after a reload races the final event.
- `POST /api/brain/runs/[runId]/cancel` cancels a non-terminal run.

IndexedDB stores only the active run ID, token, and last consumed index. Event handling is idempotent, and the token is removed at terminal state.

## Validation and publication

Generated files pass static policy, strict TypeScript, host Vitest checks, a production bundle, Chromium interaction checks, axe WCAG A/AA checks, desktop/mobile overflow checks, and screenshots. The browser contract verifies planned controls and outputs, exact defaults, accessible units and errors, safe numeric bounds, whole-year age handling, concise live status, material reactivity, chart summaries/tables, and invalid-state persistence safety.

A published `WorkspaceArtifactV2` records immutable source and bundle lineage, content hash, signed capability grant, deterministic checks, independent review, per-stage model/effort/attempt/outcome, token usage, timings, and repair count. Provider names are visible only inside collapsed technical provenance.

## Privacy-safe observability

Structured logs are keyed by request or run ID and may include stage, model, effort, attempt, response state, incomplete reason, latency, token usage, validation code, repair count, and terminal result. Logs must never contain prompts, generated source, financial data, access tokens, API keys, cookies, signed grants, or other credentials.

## Verification

Run every credential-free gate:

```bash
npm run verify:local
```

For the intentionally paid one-request release gate, start Findex locally with `WORKSPACE_EXECUTION_MODE=local`, then run:

```bash
npm run verify:live-fire-local
```

The gate submits exactly `Build a FIRE calculator for me to plan my retirement.`, reloads during the same run, rejects a second Brain POST, verifies publication and interaction, checks persisted telemetry and routing, and stops on the first failure without retrying.

Hosted validation requires a rotated `OPENAI_API_KEY`, `DEMO_SESSION_SECRET`, `VERCEL_SANDBOX_SNAPSHOT_ID`, and `WORKSPACE_EXECUTION_MODE=vercel`. `OPENAI_BUILD_MODEL` is deprecated and ignored because routing is host-owned.

# Financial Brain tool builds

This document is the operational source of truth for FinDex’s generative **My tools** pipeline. The host owns model selection, retry limits, validation, and publication. User prompts and generated source cannot change these policies. User-facing chrome says **tool** / **My tools**; code and APIs may still say `workspace`.

## Request routing

`POST /api/brain` first routes a turn as either an ordinary financial question or a tool/workspace request. The router recognizes explicit build verbs, tool/workspace nouns, active-tool revisions, and signed clarification continuations; it does not select a calculator or widget type.

Workspace requests pass through a low-cost complexity assessment. If assessment is unavailable, Findex uses `simple` so ordinary calculators draft first. Host calibration also biases ordinary calculator/FIRE/wealth prompts to `simple`. Live market/research data, runtime AI, portfolio or tax logic, state migration, or several coordinated views can raise a request to `complex`. My-money prompts default-grant relevant `ledger.*` capabilities so builds ground in Jordan’s demo ledger.

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
| Independent review | Sol, low | Sol, medium | 12K | 150s |

The initial Brain request has a 210-second ceiling and the route retains a 300-second platform limit. After planning, generation continues in a durable Workflow run with a 20-minute overall deadline. Every paid SDK call disables invisible retries.

## Bounded failure handling

- Planning permits at most two paid attempts. Token exhaustion retries with a larger output cap. A completed but semantically invalid simple/standard plan may retry once with Sol/medium. Explicit refusal, content filtering, and timeout do not escalate reasoning.
- Transient provider failures may receive one explicit same-policy planning retry. Assessment failure does not spend another request; it falls back to `simple`.
- Workspace generation permits one initial build and at most one targeted repair. After a successful preflight, Findex publishes a runnable `qualityTier: "draft"` artifact immediately so the user can interact while background sandbox validation and independent review continue.
- Every source-generation pass uses one forced, bounded `write_workspace` call containing the complete editable source set. The host immediately runs a deterministic policy, TypeScript, and bundle preflight; one failed preflight forces a single corrected `write_workspace`. Browser, accessibility, and semantic review run in the following Workflow steps as background polish.
- A build pass may retry one request with the same model, effort, output cap, and remaining deadline only after an explicit connection, 408/409/429, or 5xx transient. It never raises reasoning for provider capacity errors, and a second transient ends the pass.
- Validation retries once only for a sandbox or platform transient. Source, policy, interaction, accessibility, or financial defects are never treated as platform transients.
- **Draft publication** requires only successful host preflight (and a production bundle when the host can produce one). **Verified publication** still requires deterministic sandbox validation plus an independent review score of at least 90 with every acceptance criterion passing. Background polish may auto-swap safe fixes (`workspace_refined`) or offer behavior/formula changes (`workspace_upgrade_offer`). After a draft exists, background failure must not hard-fail the run or remove the draft.
- Numeric plan inputs carry host-aligned `min` / `max` / `step` (ordinary FIRE: whole-year ages, currency in 1000 increments with spending min 1000, percentages step 0.1). Host contract lint uses scaled integer step math (`lib/workspaces/step-check.ts`) so float noise is not a false failure; Chromium validation enforces HTML constraint/`stepMismatch` behavior for whole-unit fields. Acceptance criteria that contradict those domains are stripped before build/review.

Typed provider classification preserves response status, response ID, incomplete reason, latency, and token usage. Stable user-safe codes include `PLAN_TOKEN_LIMIT`, `PLAN_REFUSED`, `PLAN_TIMEOUT`, `PLAN_INVALID`, `MODEL_TRANSIENT`, and `MODEL_FAILED`; raw provider output is never shown to the user.

## Durable run interface

The initial Brain stream emits `workspace_started { runId, accessToken }`. The access token is HMAC-signed against both the anonymous session and exact run ID and is sent only in the authorization header.

- `GET /api/brain/runs/[runId]/events?startIndex=N` resumes indexed progress without replaying consumed events.
- `GET /api/brain/runs/[runId]` returns status and the completed Workflow `returnValue`, allowing publication recovery after a reload races the final event.
- `POST /api/brain/runs/[runId]/cancel` cancels a non-terminal run.

IndexedDB stores only the active run ID, token, and last consumed index. Event handling is idempotent, and the token is removed at terminal state.

## Validation and publication

Generated files pass static policy, strict TypeScript, host Vitest checks, a production bundle, Chromium interaction checks, axe WCAG A/AA checks, desktop/mobile overflow checks, and screenshots. The browser contract verifies planned controls and outputs, exact defaults, accessible units and errors, safe numeric bounds, whole-year age handling, concise live status, material reactivity, chart summaries/tables, and invalid-state persistence safety.

A published `WorkspaceArtifactV2` records `qualityTier` (`draft` | `verified`), immutable source and bundle lineage, content hash, signed capability grant, deterministic checks, independent review (pending placeholder for drafts), per-stage model/effort/attempt/outcome, token usage, timings, and repair count. Provider names are visible only inside collapsed technical provenance.

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

The gate submits exactly `Build a FIRE calculator for me to plan my retirement.`, expects an interactive draft (or verified) publication, reloads during the same run, rejects a second Brain POST, verifies interaction, checks persisted telemetry and routing, and stops on the first failure without retrying.

For a grounded my-money smoke (ledger capabilities on the published plan):

```bash
npm run verify:grounded-build-local
```

For credential-free host bundler/preflight parity:

```bash
npm run verify:workspace-offline
```

Hosted validation requires a rotated `OPENAI_API_KEY`, `DEMO_SESSION_SECRET`, `VERCEL_SANDBOX_SNAPSHOT_ID`, and `WORKSPACE_EXECUTION_MODE=vercel`. `OPENAI_BUILD_MODEL` is deprecated and ignored because routing is host-owned.

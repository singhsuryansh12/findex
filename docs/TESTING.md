# Testing and release verification

## Test suites

| Suite | Command | Coverage |
| --- | --- | --- |
| Unit | `npm run test:unit` | Ledger/portfolio reconciliation, cash-flow and purchase scenarios, schemas, complexity floors, policy, signing, provider normalization, quotas, RPC inputs, Brain guidance copy, messaging ban-list over scoped UI source |
| Integration | `npm run test:integration` | Brain SSE, capability authorization, immutable IndexedDB versions, state, strict builder preflight parity, actionable compiler diagnostics, explicit failure behavior |
| Standard validation | `npm run validate` | TypeScript, all non-live Vitest suites, ESLint, production Next.js build |
| Local sandbox parity | `npm run test:local-sandbox` | Fixed build commands, Vitest, Chromium controls, screenshots, responsive output |
| End-to-end | `npm run test:e2e` | Try the demo → Brain-first home, messaging/copy assertions and desktop screenshot goldens, Spending/Portfolio/Cash Flow journeys, guidance/handoff, filters, recurring calendar, charts and table alternatives, decision scenarios, axe scans, reflow, iframe isolation, My tools persistence, version UI, refresh/back navigation |
| Generative corpus | `RUN_LIVE_GENERATION_EVALS=1 npm run test:gen-eval` | More than 40 varied, ambiguous, revision, out-of-scope, and adversarial prompts |
| Live providers | `RUN_LIVE_PROVIDER_EVALS=1 npm run test:live-providers` | OpenAI runtime analysis, normalized Twelve Data, network-denied Vercel Sandbox |
| One-shot local FIRE gate | `npm run verify:live-fire-local` | Exactly one Brain POST, durable reload reconnection, standard/Terra routing, validated publication, interactive retirement output, visible assumptions and disclosure, persistence, browser console |

`npm run verify:local` runs every credential-free release gate, including Chromium. The CI workflow uses the same sequence on pull requests and `main`.

The browser suite builds and starts an isolated production-mode keyless server on port 3107 and intercepts every Financial Brain request used by its mocked flows. It never reuses a developer server, so an OpenAI key loaded by local development cannot be reached by an offline browser test.

Messaging screenshot goldens live under `tests/e2e/findex.spec.ts-snapshots/` (darwin + linux desktop). Update them with `npx playwright test -g "messaging surfaces" --project=desktop --update-snapshots` (use the Playwright Docker image on Linux when refreshing CI baselines).

## Environment-gated checks

Live evaluations require `OPENAI_API_KEY`, `TWELVE_DATA_API_KEY`, and `VERCEL_SANDBOX_SNAPSHOT_ID`. Set `WORKSPACE_EXECUTION_MODE=vercel` for release verification. The generative corpus writes its report to ignored `test-results/generative-eval.json`.

The one-shot local FIRE gate requires a running local FinDex development server with `WORKSPACE_EXECUTION_MODE=local`. Rotate any key that has appeared in terminal or diagnostic output before running it. The gate never retries: it submits once with Enter, reloads during the same durable run, and exits on the first failure.

## Verified baseline

The 2026-07-20 release gate completed with one Brain POST and no browser console errors. The exact FIRE request routed as `standard`, used Terra/medium for the initial build, performed one diagnostics-driven Sol repair, passed every deterministic check, published and persisted an interactive calculator after a mid-run reload, and received a 97/100 independent review. The accompanying credential-free baseline passed 85 Vitest checks, five local-sandbox browser builds, the production Next.js/Workflow build, and 29 Playwright flows; environment-gated live/replay cases remained explicitly skipped.

The 2026-07-21 messaging overhaul extended the credential-free gate with guidance/messaging unit contracts, a scoped UI ban-list, an e2e messaging journey, and desktop brand screenshot goldens. Re-run `npm run verify:local` after any user-facing copy change.

Do not silently skip provider checks during a production release. If credentials or an external service are unavailable, record the missing gate in the release notes and do not claim live-provider verification.

## Acceptance expectations

- Schema, policy, TypeScript, bundle, and iframe-isolation gates must pass.
- Every planned input must be accessible and materially change non-control output.
- Every planned output must be visible at desktop or mobile sizes.
- No console error or document overflow is allowed.
- Serious/critical axe violations, missing visible focus, missing semantic table/chart alternatives, and 390px/200%-equivalent reflow failures are release blockers.
- No unrelated fallback, fabricated live value, uncited research claim, or hidden credential is allowed.
- Independent review must score at least 90 and pass every acceptance criterion.
- User-facing brand copy must keep the dual promise (data already present + tools you build/keep) and must not reintroduce banned phrases from `tests/unit/messaging-banlist.test.ts`.

## Debugging failures

1. Reproduce the smallest failing suite.
2. Preserve the previous published tool; never weaken policy or substitute a sample.
3. Inspect the validation report, console errors, and generated screenshots.
4. Add a regression test before changing behavior.
5. Rerun `npm run verify:local` before committing.

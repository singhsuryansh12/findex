# Testing and release verification

## Test suites

| Suite | Command | Coverage |
| --- | --- | --- |
| Unit | `npm run test:unit` | Ledger/portfolio reconciliation, cash-flow and purchase scenarios, schemas, complexity floors, policy, signing, provider normalization, quotas, RPC inputs |
| Integration | `npm run test:integration` | Brain SSE, capability authorization, immutable IndexedDB versions, state, explicit failure behavior |
| Standard validation | `npm run validate` | TypeScript, all non-live Vitest suites, ESLint, production Next.js build |
| Local sandbox parity | `npm run test:local-sandbox` | Fixed build commands, Vitest, Chromium controls, screenshots, responsive output |
| End-to-end | `npm run test:e2e` | Brain-first login, routed Spending/Portfolio/Cash Flow journeys, filters, recurring calendar, charts and table alternatives, decision scenarios, axe scans, reflow, iframe isolation, persistence, version UI, refresh/back navigation |
| Sol corpus | `RUN_LIVE_GENERATION_EVALS=1 npm run test:gen-eval` | More than 40 varied, ambiguous, revision, out-of-scope, and adversarial prompts |
| Live providers | `RUN_LIVE_PROVIDER_EVALS=1 npm run test:live-providers` | OpenAI runtime analysis, normalized Twelve Data, network-denied Vercel Sandbox |

`npm run verify:local` runs every credential-free release gate, including Chromium. The CI workflow uses the same sequence on pull requests and `main`.

## Environment-gated checks

Live evaluations require `OPENAI_API_KEY`, `TWELVE_DATA_API_KEY`, and `VERCEL_SANDBOX_SNAPSHOT_ID`. Set `WORKSPACE_EXECUTION_MODE=vercel` for release verification. The Sol corpus writes its report to ignored `test-results/generative-eval.json`.

Do not silently skip provider checks during a production release. If credentials or an external service are unavailable, record the missing gate in the release notes and do not claim live-provider verification.

## Acceptance expectations

- Schema, policy, TypeScript, bundle, and iframe-isolation gates must pass.
- Every planned input must be accessible and materially change non-control output.
- Every planned output must be visible at desktop or mobile sizes.
- No console error or document overflow is allowed.
- Serious/critical axe violations, missing visible focus, missing semantic table/chart alternatives, and 390px/200%-equivalent reflow failures are release blockers.
- No unrelated fallback, fabricated live value, uncited research claim, or hidden credential is allowed.
- Independent review must score at least 90 and pass every acceptance criterion.

## Debugging failures

1. Reproduce the smallest failing suite.
2. Preserve the previous published workspace; never weaken policy or substitute a sample.
3. Inspect the validation report, console errors, and generated screenshots.
4. Add a regression test before changing behavior.
5. Rerun `npm run verify:local` before committing.

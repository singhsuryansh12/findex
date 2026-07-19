# FinDex demo runbook

## Freeze checklist

- [ ] `npm run verify:local` passes from a clean checkout.
- [ ] No console errors or horizontal overflow on desktop and 390×844.
- [ ] `OPENAI_API_KEY`, `TWELVE_DATA_API_KEY`, `VERCEL_SANDBOX_SNAPSHOT_ID`, `WORKSPACE_EXECUTION_MODE=vercel`, and a strong `DEMO_SESSION_SECRET` are configured.
- [ ] No credential uses a `NEXT_PUBLIC_` prefix or appears in generated source, bundles, sandbox environment, or iframe messages.
- [ ] Vercel Sandbox shows deny-all networking and no running sandbox after success, repair, failure, abort, and timeout.
- [ ] A missing OpenAI/provider key produces a clear unavailable state and never publishes a fallback calculator.
- [ ] The deployed Brain route supports the 300-second maximum duration.

## Demo path

1. Login as the demo user and show the populated ledger and 30-day forecast.
2. Ask **How much did I spend on dining out last month?** and show `$366.21`, eight transactions, and the June provenance chip.
3. Ask for a custom workspace unrelated to retirement, such as a cash-versus-financing decision lab.
4. Narrate complexity assessment, structured planning, coding, checks, independent review, and immutable publication.
5. Change every generated input and show relevant outputs update without URL navigation.
6. Prompt a revision such as **Add an opportunity-cost chart and CSV export**; verify version 2 retains version 1 in history.
7. Create another workspace, switch between projects, rename, duplicate, restore a version, and reload.
8. Demonstrate a live-data workspace with source and freshness, then show its explicit unavailable state with the provider key disabled.
9. Open the generated source/plan, validation score, effort, complexity rationale, capabilities, and educational disclosure.
10. Repeat the core path at 390px and confirm the generated iframe and Brain remain usable.

## Security smoke checks

- Request `fetch`, local storage, parent DOM access, an iframe, a new npm package, environment secrets, or arbitrary shell commands; the build must fail policy checks.
- Attempt to invoke an ungranted capability or reuse an artifact grant with another artifact ID; the broker must return 403.
- Force invalid TypeScript and confirm repair escalates effort one tier before publication.
- Force final review failure or timeout and confirm the prior workspace version remains active.
- Inspect the generated iframe: its sandbox attribute is exactly `allow-scripts`, its CSP has `connect-src 'none'`, and its origin is opaque.

## Live evaluation

Run before freezing a release:

```bash
npm run test:local-sandbox
RUN_LIVE_GENERATION_EVALS=1 LIVE_EVAL_BUILD_LIMIT=5 npm run test:gen-eval
RUN_LIVE_PROVIDER_EVALS=1 npm run test:live-providers
```

Review `test-results/generative-eval.json` for relevance, disclosed assumptions, correct capability grants, review scores of at least 90, and zero FIRE/unrelated fallback leakage.

## Recovery

- **OpenAI unavailable:** deterministic ledger prompts remain functional; generative requests report unavailable without changing the active workspace.
- **Vercel Sandbox unavailable:** the build fails safely and retains the last published version. Do not switch production to the local executor.
- **Twelve Data unavailable:** market tools show unavailable/stale status; they never silently use demo prices.
- **Deployment regression:** roll back to the last verified deployment and preserve browser-stored workspaces.

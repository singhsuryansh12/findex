# FinDex demo runbook

## Freeze checklist

- [ ] `npm run verify:local` passes from a clean checkout.
- [ ] No console errors or horizontal overflow on desktop and 390×844.
- [ ] Landing shows **Finance, personal by design** / **Your money, your tools.** and the **Try the demo** CTA.
- [ ] `OPENAI_API_KEY`, `TWELVE_DATA_API_KEY`, `VERCEL_SANDBOX_SNAPSHOT_ID`, `WORKSPACE_EXECUTION_MODE=vercel`, and a strong `DEMO_SESSION_SECRET` are configured.
- [ ] No credential uses a `NEXT_PUBLIC_` prefix or appears in generated source, bundles, sandbox environment, or iframe messages.
- [ ] Vercel Sandbox shows deny-all networking and no running sandbox after success, repair, failure, abort, and timeout.
- [ ] A missing OpenAI/provider key produces a clear unavailable state and never publishes a fallback calculator.
- [ ] The deployed Brain route supports the 300-second maximum duration.

## Demo path

1. Open the app and choose **Try the demo**. Confirm `/demo/brain` with the **Your money, your tools.** hero, Getting started guidance, Financial Brain composer, Ask / Decide / Build help, three financial glances, and no chart overload.
2. Ask **How much did I spend on dining out last month?** and show `$366.21`, eight transactions, June provenance, calculation notes, and the Spending deep link.
3. Open Spending, apply the last-calendar-month + Dining filters, and reconcile the `$366.21` summary with eight displayed rows. Show Recurring in both list and calendar layouts. Use **Ask the Brain** and confirm the handoff banner.
4. Open Portfolio and reconcile `$145,450` of investments, `$180,557.72` net worth, the 60/20/15/5 synthetic target comparison, account cards, contributions, and holdings.
5. Open Cash Flow, switch between 30/60/90 days, inspect assumptions and the table alternative, and expand the checking runway.
6. Return to the Brain and test a car on `2026-08-15` with `$15,000` upfront and `$650/month`; show the base-versus-scenario **Not covered** result.
7. Ask for a custom tool unrelated to retirement, such as a cash-versus-financing decision lab, and narrate assessment, planning, draft publication, checks, review, and verified polish.
8. Open **My tools** (tool library), change generated inputs, revise the tool, verify version history, rename, duplicate, restore, and reload.
9. Demonstrate a live-data tool with source and freshness, then show its explicit unavailable state with the provider key disabled.
10. Repeat the core path at 390px and confirm the four-item bottom navigation, tables/cards, tool iframe, and Brain remain usable without horizontal overflow.

## Security smoke checks

- Request `fetch`, local storage, parent DOM access, an iframe, a new npm package, environment secrets, or arbitrary shell commands; the build must fail policy checks.
- Attempt to invoke an ungranted capability or reuse an artifact grant with another artifact ID; the broker must return 403.
- Force invalid TypeScript and confirm repair escalates effort one tier before verified publication.
- Force final review failure or timeout and confirm the prior tool version remains active (draft may remain while polish fails).
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

- **OpenAI unavailable:** deterministic ledger prompts remain functional; generative requests report unavailable without changing the active tool.
- **Vercel Sandbox unavailable:** the build fails safely and retains the last published version. Do not switch production to the local executor.
- **Twelve Data unavailable:** market tools show unavailable/stale status; they never silently use demo prices.
- **Deployment regression:** roll back to the last verified deployment and preserve browser-stored My tools projects.

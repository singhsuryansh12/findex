# FinDex demo runbook

## Freeze checklist

- [ ] Public repository is accessible in a signed-out browser.
- [ ] Vercel deployment is public and uses the frozen commit.
- [ ] `npm run validate` passes from a clean checkout.
- [ ] `npm run test:e2e` passes after `npx playwright install chromium`.
- [ ] No browser console errors on desktop or a 390×844 viewport.
- [ ] `OPENAI_API_KEY`, `E2B_API_KEY`, `E2B_TEMPLATE`, and `DEMO_SESSION_SECRET` are present in Vercel.
- [ ] No secret is prefixed `NEXT_PUBLIC_` or included in a client bundle.
- [ ] Live sandbox generation completes in under 90 seconds.
- [ ] E2B shows no orphaned sandboxes after success, retry, failure, abort, and timeout checks.
- [ ] Fallback is visibly labeled “Verified sample” with a working Retry control.

## Two-minute judging path

1. Open the public URL in a clean browser profile.
2. Choose **Login as Demo User**. Call out the frozen “As of Jul 19” label and populated dashboard.
3. Hover or focus the forecast and point out the Jul 20 card payment, Jul 24 cash trough, reserve line, and Aug 1 income.
4. Ask: **How much did I spend on dining out last month?**
5. Show the exact `$366.21`, 8-transaction, June 1–30 provenance chip. TypeScript computed the result; the model selected the tool and explained it.
6. Ask: **Build me a FIRE calculator.**
7. Narrate sandboxing, coding, validation, and rendering stages.
8. Show the “Built live by Codex” badge, source view, validation results, and unchanged URL.
9. Adjust monthly contribution, retirement age, and return rate. Show instant chart/stat recomputation.
10. Resize to mobile or use the prepared 390px device view; open the full-screen Brain sheet.

## Live service smoke test

Run once locally and once against the deployed URL before freeze:

- Brain generic query uses `OPENAI_CHAT_MODEL` and returns a deterministic tool result.
- FIRE build uses `CODEX_MODEL`, edits only the allowlisted files, and returns `mode: live`.
- Validation report contains typecheck, lint, render/interaction test, bundle, and host policy scan.
- Generated source has no account IDs or unrelated transactions.
- Refresh preserves the artifact; Reset Demo removes it.
- Disable `ENABLE_LIVE_WIDGETS` and verify the labeled sample plus Retry path.
- Force an invalid artifact or timeout in a non-production branch and verify the sample is returned and the sandbox is killed.

## Recovery

- **OpenAI unavailable:** set `ENABLE_LIVE_WIDGETS=false`; deterministic dashboard/Brain demo routes and the verified sample remain functional.
- **E2B unavailable:** the route catches failure, kills any created sandbox, and returns the labeled sample.
- **Slow venue network:** preload the public page and keep a second clean tab ready. Do not represent the sample as live output.
- **Deployment regression:** roll Vercel back to the frozen deployment; do not change finance fixture values during judging.

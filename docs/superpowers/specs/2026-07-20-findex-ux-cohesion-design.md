# Findex UX Cohesion — Design Spec

**Date:** 2026-07-20  
**Status:** Approved for implementation planning  
**Approach:** Progressive polish on the current shell (Approach 1)

## Goal

Make Findex feel like one cohesive, calm financial OS for non-technical, non-finance users: smooth navigation, readable typography, and a self-explanatory Financial Brain — without redesigning the existing theme or breaking Brain / workspace functionality.

## Decisions locked

| Topic | Choice |
|-------|--------|
| Scope | Core polish + Brain guidance + a tight set of shippable UX extras |
| Brain guidance | Hybrid: page-aware suggestion chips + quiet `?` popover (no forced tour) |
| Typography | Comfortable: body ~14–15px, labels ~12–13px; keep DM Sans + Instrument Serif and current color system |
| Page motion | Shared-element polish via View Transitions API + CSS fallback; respect `prefers-reduced-motion` |
| UX extras | Orientation + insight: ~3–5 small features; heavier ideas deferred to a follow-up list |
| Architecture | Keep `/demo/[view]` routing and `FinDexApp` shell; no animation library; no new backend APIs |

## Problem statement

1. **Navigation flicker** — Moving between Financial Brain, Spending, Portfolio, and Cash flow uses hard `router.push` swaps that remount view trees with no transition, so the app feels discontinuous.
2. **Typography too small** — Many UI surfaces use ~7–11px type, which forces zoom and weakens hierarchy for demo users.
3. **Brain not self-explanatory** — “Ask the Brain” redirects to chat with a prompt, but pages do not clearly show what users can *ask*, *decide*, or *build*.
4. **Control & clarity gaps** — Key metrics and handoffs lack short plain-language cues that would help non-finance users stay oriented.

## Non-goals

- Real bank linking, budgets/goals engines, multi-user, or new model/routing policy
- Forced coach-mark tours or Framer Motion / heavy animation libraries
- Full design-system rewrite or theme/font replacement
- Approach 2 (keep-all-views-mounted SPA) unless Approach 1 still flickers after ship
- Extreme features that take weeks/months

## Architecture

Keep the Brain-first shell. No new routes and no new data models.

```text
Shell (sidebar + topbar)     ← stays mounted, visually stable
  └─ View stage               ← View Transitions + shared-element names
       ├─ brain
       ├─ spending
       ├─ portfolio
       └─ cash-flow
```

### Navigation & motion

- Continue using `router.push('/demo/{view}')`.
- Wrap content swaps with the **View Transitions API** when available.
- Assign stable `view-transition-name`s to the page title block and **Ask the Brain** control so they morph across routes.
- Fallback: short opacity / slight translate crossfade on the main stage inside `.fd-app-content`.
- When `prefers-reduced-motion: reduce`, skip morph/fade and swap content instantly.

### Ask → Brain handoff

- Extend `askBrain(prompt, meta?)` to set:
  - existing `widgetPrompt` (auto-consumed by `BrainPanel`)
  - new session-only `handoff` state: `{ source, label, prompt }`
- Navigate to `/demo/brain` under the same transition path.
- Default: React state only (no query-string clutter). Refresh while on Brain may drop the banner; that is acceptable for this pass.

### Typography

- Add CSS variables on `:root` (e.g. `--fd-text-body`, `--fd-text-meta`, `--fd-text-label`, `--fd-text-caption`).
- Remap existing `.fd-*` rules to the scale — **same font families and colors**, larger readable sizes.
- Comfortable targets:
  - Body / chat / table cells: ~14–15px
  - Labels / filters / nav descriptions: ~12–13px
  - True captions / eyebrows: no smaller than ~11px where still used
  - Display serif headlines: stay expressive; slightly less tiny on mobile

### Guidance module

- Thin client module (`BrainGuidance`) holding a static, page-keyed content map (not LLM-generated).
- Surfaces: suggestion chips + `?` popover.
- Dismiss / “don’t show tip” preferences in `sessionStorage` for the browser session.

## Components & UI surfaces

| Piece | Role |
|-------|------|
| View stage wrapper | Owns transition class + reduced-motion behavior around swapping `<main>` content |
| `BrainGuidance` | Page-keyed chips + quiet `?` popover (“Ask · Decide · Build”) |
| `BrainHandoffBanner` | One-line context after cross-page Ask the Brain; dismissible |
| `MetricHint` | Optional one-liner under jargon-prone metrics |
| Typography tokens | CSS variables remapped across existing classes |

### Per-page behavior

- **Brain home** — Welcome states three jobs in plain language (ask / decide / build a tool). Chips cover the mix. `?` expands examples. After an assistant answer, show 1–2 “try next” chips.
- **Spending / Portfolio / Cash flow** — Keep existing Ask the Brain buttons. Add page-relevant chips and a `?` that explains what Brain can do *from this page*.
- **Handoff** — Banner example: “From Spending — asking where money went last month.” Auto-dismiss after first send or manual close.

### Visual rules (preserve theme)

- No new card chrome in heroes; chips stay lightweight (text + soft border).
- `?` is icon-only, muted; never a spotlight tour or modal gauntlet.
- Metric one-liners only where jargon would confuse — not under every number.
- Classy, minimal, insightful — prefer one clear line over decorative UI noise.

## Data flow & state

```text
[Spending|Portfolio|Cash flow]
        │ Ask the Brain(prompt)
        ▼
askBrain(prompt, { source, label })
        │
        ├─ setWidgetPrompt(prompt)
        ├─ setHandoff({ source, label, prompt })
        └─ router.push('/demo/brain')  (+ view transition)
                │
                ▼
BrainPanel consumes initialPrompt
Handoff banner renders from handoff state
chips / ? read current view key
```

| State | Where | Lifetime |
|-------|--------|----------|
| `widgetPrompt` | Existing React state | Until `BrainPanel` consumes it |
| `handoff` | New React state | Until dismiss, first send, or leave Brain |
| Guidance dismiss | `sessionStorage` | Rest of browser session |
| View / URL | `/demo/[view]` | Unchanged |
| Typography / motion | CSS only | N/A |

### Static guidance examples (illustrative)

- **Spending** — “Where did dining go last month?”, “What recurring bills hit next?”
- **Portfolio** — “Is my allocation on target?”, “Explain my biggest holding”
- **Cash flow** — “What’s safe to spend?”, “Stress-test a car purchase”
- **Brain** — Mix of ask / decide / build prompts already close to today’s suggestions

## Shippable UX extras (this pass)

1. **Contextual handoff banner** — source page + plain-language ask; dismissible  
2. **Page-aware suggestion chips** + quiet **`?` help**  
3. **Metric one-liners** — at least: safe to spend, allocation drift, runway / outlook  
4. **Post-answer “try next”** — 1–2 chips after a Brain reply  
5. **Clearer Brain welcome** — three capabilities in plain language  

## Error & edge cases (UI)

- View Transitions unsupported → CSS fade fallback; navigation still works  
- Double-click Ask the Brain → one navigation; prompt not duplicated  
- Open Brain directly → no handoff banner; normal welcome + chips  
- Reduced motion → instant content swap  
- Workspace build / SSE in progress → transitions and guidance never cancel or interrupt the run  

## Testing & verification

Thorough end-to-end verification is a **release requirement** for this work — not a nice-to-have. Changes ship only after frontend UX coverage **and** backend/regression suites pass with sufficient breadth. Prefer extending existing harnesses in `tests/` and the gates in `docs/TESTING.md` over inventing parallel tooling.

### Release gate (must all pass before claiming done)

| Gate | Command | Required |
|------|---------|----------|
| Typecheck + unit + integration + lint + production build | `npm run validate` | Yes |
| Playwright E2E (includes production build) | `npm run test:e2e` | Yes |
| Full credential-free local verify (when touching workspace/sandbox paths or as final ship check) | `npm run verify:local` | Yes for final ship; at minimum `validate` + `test:e2e` after each meaningful slice |
| Live / generative evals | `test:gen-eval` / `test:live-providers` / `verify:live-fire-local` | Only if Brain routing or workspace build contracts change; otherwise record “not required — UI-only” in the PR notes |

If any gate fails, **fix before proceeding** — do not weaken assertions, skip suites, or claim UX polish while regressions remain.

### Frontend coverage matrix (new + regression)

| Area | Cases to cover | How |
|------|----------------|-----|
| Landing → demo | Enter demo lands on Brain; shell renders | E2E (existing + extend) |
| Cross-view navigation | Brain ↔ Spending ↔ Portfolio ↔ Cash flow via sidebar **and** mobile nav; URL matches view; shell (sidebar/topbar) remains stable | E2E |
| Motion / reduced motion | Default path completes without hang; `prefers-reduced-motion: reduce` still navigates and shows correct view | E2E (+ manual spot-check for morph quality) |
| Ask the Brain handoff | From Spending, Portfolio, and Cash flow: navigates to Brain, prompt consumed, handoff banner visible with source label, dismiss works, banner gone after first send | E2E |
| Brain guidance | Chips visible per page; chip click fills/sends expected prompt path; `?` opens/closes; Escape/keyboard dismiss; session dismiss persists within session | E2E + unit for content map |
| Brain welcome / try-next | Welcome states Ask · Decide · Build; after mocked assistant reply, try-next chips appear and are actionable | E2E (mocked Brain, same pattern as existing suite) |
| Metric hints | Safe-to-spend, allocation drift, runway/outlook one-liners present where specified | E2E or component assertion |
| Typography readability | Computed styles for body/table/chat meet minimum comfortable sizes (e.g. body ≥ 14px) on desktop and ~390px mobile; no horizontal document overflow | E2E asserts + manual |
| Spending | Search, date presets, filters, activity vs recurring, recurring list/calendar | E2E regression (extend existing) |
| Portfolio | Holdings/allocation surfaces still interactive; Ask the Brain still works | E2E regression |
| Cash flow | Forecast / safe-to-spend / ask-about-month still work | E2E regression |
| My tools / workspaces | Library select, open artifact, version UI; iframe isolation unchanged | E2E regression (existing) |
| Demo reset | Clears local tools and returns to landing | E2E |
| A11y | axe on Brain + one detail view after changes; `?` and banner have accessible names; focus not trapped; no new serious/critical axe violations | E2E (`@axe-core/playwright`) |
| Console hygiene | No new console errors during nav + handoff + mocked Brain flows | E2E |

### Backend / domain coverage matrix (regression — UI must not break contracts)

UI-only work still requires these suites so navigation/handoff refactors cannot silently break the Brain or workspace stack:

| Area | Suite | Why |
|------|-------|-----|
| Brain intent routing | `tests/unit/brain-routing.test.ts` | Ask/build classification unchanged |
| Brain SSE / route | `tests/integration/brain-route.test.ts` | Prompt from handoff still hits `/api/brain` correctly |
| Finance ledger / cash flow / portfolio math | `tests/unit/finance-core.test.ts` | Metric copy must not imply wrong numbers |
| Capability / artifact token | `tests/integration/capability-route.test.ts` | Workspace grants unchanged |
| Workspace persistence | `tests/integration/workspace-persistence.test.ts` | My tools library still durable |
| Workspace policy, quotas, grounding, bundle, model policy, workflow failures | existing `tests/unit/workspace-*.test.ts` + workflow unit tests | No accidental import/contract drift |
| Preflight / sandbox parity | integration + `test:local-sandbox` when generator/sandbox touched | Only if those files change |

**Rule:** Every PR slice for this initiative runs `npm run test:unit` and `npm run test:integration` (via `validate`). Do not treat “CSS-only” as exempt from Brain/integration regression.

### Unit tests to add (UX-specific)

Extract pure helpers where needed and cover:

1. **Guidance map** — every `DemoView` key has chips + `?` copy; no empty pages  
2. **Handoff state machine** — create → dismiss; create → consume-on-send; leave Brain clears  
3. **`viewFromPath` / nav helpers** — path ↔ view mapping (if extracted)  
4. **Typography token invariants** (optional) — CSS variable presence or documented min sizes in a small contract test if practical  

### E2E tests to add or extend

Extend `tests/e2e/findex.spec.ts` (or a focused sibling) with explicit cases for:

1. Smooth nav smoke: visit each `/demo/*` route in sequence; assert landmark headings and no crash  
2. Ask the Brain from each detail page with handoff banner assertions  
3. Guidance chips + `?` on Brain and at least one detail page  
4. Reduced-motion navigation  
5. Minimum font-size checks on transaction list / chat input / metric labels  
6. Existing mocked Brain + workspace journeys still green  

### Manual verification checklist (required once before merge)

- [ ] Navigate all four pages quickly: no hard white flash / layout jump of the shell  
- [ ] Shared-element morph feels calm (or fade fallback is acceptable on unsupported browsers)  
- [ ] Read Spending transactions and Brain chat without zooming (desktop + phone width)  
- [ ] Non-finance plain-language: chips/`?`/metric hints make Ask · Decide · Build obvious  
- [ ] Start a workspace build (dev) and navigate away/back: run not cancelled by UI transitions  
- [ ] Theme still feels like Findex (paper, emerald, serif display) — polish, not a redesign  

### Must not break (summary)

- Landing → enter demo → Brain home  
- Nav between all four views (desktop + mobile)  
- Ask the Brain from Spending / Portfolio / Cash flow → prompt lands and runs  
- Brain Q&A SSE, purchase decision UI, workspace build / reconnect / cancel  
- My tools drawer and library select / rename / duplicate / delete / restore  
- Spending filters, recurring list/calendar, portfolio & cash-flow interactions  
- Demo reset  
- All credential-free backend suites above  

### Success criteria

- Page changes feel continuous (shell stable; content morph/fade, not a hard cut)  
- Body, tables, and chat readable without zoom at laptop and phone widths  
- A non-finance user can discover Ask / Decide / Build without a separate tutorial  
- Existing Brain and workspace functionality unchanged  
- **`npm run validate` and `npm run test:e2e` are green**; final ship also clears `npm run verify:local` when applicable  
- New UX behaviors have automated coverage listed in the matrices above — not “manually verified only” 

## Follow-up proposals (document only — not this pass)

Ideas researched / brainstormed for later, kept intentionally out of scope:

- Simple “monthly digest” card on Brain home  
- “Explain this chart” action on cash-flow forecast  
- Saved recent Brain questions (local)  
- Export today’s brief as plain text  
- Lightweight goal / progress stub (UI-only)  
- Approach 2 soft-SPA if shared-element transitions are still insufficient  

## Implementation boundaries

**Primary touchpoints (expected):**

- `components/dashboard/findex-app.tsx` — navigation transition, handoff state, stage wrapper  
- `components/brain/brain-panel.tsx` — welcome copy, try-next chips, handoff consume  
- `components/dashboard/{spending,portfolio,cash-flow}-view.tsx` — chips, `?`, metric hints, ask meta  
- `app/globals.css` — typography tokens, view-transition / reduced-motion styles  
- New small presentational components under `components/brain/` or `components/dashboard/`  
- Tests under `tests/unit`, `tests/integration` (regression), and `tests/e2e` per the coverage matrices above  

**Must preserve:** theme tokens (`--ink`, `--paper`, `--emerald`, serif display), demo data contracts, `/api/brain` SSE behavior, workspace artifact persistence.

**Verification obligation:** Implementation plan must include explicit tasks to add/extend automated tests and to run the release gates; “done” means gates green, not merely UI merged.

## Research notes (summary)

- **View Transitions API** is the modern baseline for flicker-free MPA/SPA navigations with progressive enhancement ([Chrome docs](https://developer.chrome.com/docs/web-platform/view-transitions), MDN).  
- **NN/g AI chat guidance:** tailor opening messages and suggested prompts to the page the user is on; use progressive disclosure.  
- **Onboarding:** prefer contextual chips/tooltips over auto-fired coach-mark tours; tooltips at decision points outperform long tours.  
- **Finance UX / readability:** clear hierarchy and avoid forcing zoom; plain language under dense numbers.

## Open points resolved in design

| Question | Resolution |
|----------|------------|
| Scope | C — polish + guidance + tight extras |
| Guidance pattern | Hybrid chips + `?` |
| Type scale | Comfortable (B) |
| Motion | Shared-element View Transitions (C) |
| Extras cluster | Orientation + insight, ~3–5 items |
| Delivery approach | Progressive polish on current shell |

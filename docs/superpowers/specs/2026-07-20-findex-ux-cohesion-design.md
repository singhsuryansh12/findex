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

### Must not break

- Landing → enter demo → Brain home  
- Nav between all four views (desktop sidebar + mobile nav)  
- Ask the Brain from Spending / Portfolio / Cash flow → prompt lands and runs  
- Brain Q&A SSE, purchase decision UI, workspace build / reconnect / cancel  
- My tools drawer and library select / rename / duplicate / delete / restore  
- Spending filters, recurring list/calendar, portfolio & cash-flow interactions  
- Demo reset  

### Verification layers

| Layer | What |
|-------|------|
| Manual / browser | Every view: no hard flicker, readable type, calm chips/`?`/handoff |
| Unit | Guidance map keys, handoff dismiss rules, extracted view helpers |
| E2E (Playwright) | Cross-view nav; Ask the Brain from Spending reaches Brain UI; reduced-motion path does not hang |
| A11y smoke | `?` popover keyboard-dismissible; banner has appropriate `aria`; contrast spirit preserved |

### Success criteria

- Page changes feel continuous (shell stable; content morph/fade, not a hard cut)  
- Body, tables, and chat readable without zoom at laptop and phone widths  
- A non-finance user can discover Ask / Decide / Build without a separate tutorial  
- Existing Brain and workspace functionality unchanged  

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
- Tests under `tests/unit` and `tests/e2e` as needed  

**Must preserve:** theme tokens (`--ink`, `--paper`, `--emerald`, serif display), demo data contracts, `/api/brain` SSE behavior, workspace artifact persistence.

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

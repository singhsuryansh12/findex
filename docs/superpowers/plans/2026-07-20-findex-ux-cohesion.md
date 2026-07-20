# Findex UX Cohesion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Findex navigation, typography, and Financial Brain guidance feel seamless and self-explanatory for non-finance users, without changing the theme or breaking Brain/workspace behavior.

**Architecture:** Progressive polish on the existing `FinDexApp` shell and `/demo/[view]` routes. Enable Next/React View Transitions with CSS shared-element names and a reduced-motion fallback. Add a static page-keyed guidance module, session-only Ask→Brain handoff state, metric one-liners, and a comfortable typography token scale in `globals.css`. No new backend APIs or animation libraries.

**Tech Stack:** Next.js 16 App Router, React 19 (`ViewTransition`), CSS View Transitions, Vitest, Playwright, existing Brain SSE mocks.

## Global Constraints

- Preserve theme: `--ink`, `--paper`, `--emerald`, DM Sans, Instrument Serif — improve sizes, do not redesign.
- Keep `/demo/[view]` routing and demo data contracts; no Framer Motion; no forced coach-mark tours.
- Do not change `/api/brain` contracts, workspace build policy, or sandbox rules.
- `prefers-reduced-motion: reduce` → instant content swap (no morph/fade).
- Handoff is React session state only (refresh may drop banner — acceptable).
- Ship only when `npm run validate` and `npm run test:e2e` are green; final ship also runs `npm run verify:local` when workspace/sandbox paths were touched (otherwise record UI-only in notes).
- Every task ends with tests green for that slice + a commit.

## File map

| File | Responsibility |
|------|----------------|
| `lib/brain/guidance.ts` | `DemoView`, guidance map, handoff types/helpers, try-next prompts (new) |
| `lib/brain/navigation.ts` | `viewFromPath`, `navigateWithTransition` helper (new) |
| `components/brain/brain-guidance.tsx` | Chips + `?` popover UI (new) |
| `components/brain/brain-handoff-banner.tsx` | Cross-page handoff banner (new) |
| `components/dashboard/metric-hint.tsx` | Plain-language metric one-liner (new) |
| `components/dashboard/findex-app.tsx` | Wire transitions, handoff state, stage wrapper, guidance on Brain home |
| `components/brain/brain-panel.tsx` | Welcome copy, try-next chips, notify parent on send for handoff clear |
| `components/dashboard/spending-view.tsx` | Guidance, ask meta, readable table hooks |
| `components/dashboard/portfolio-view.tsx` | Guidance, ask meta, drift `MetricHint` |
| `components/dashboard/cash-flow-view.tsx` | Guidance, ask meta, safe-to-spend / runway hints |
| `app/globals.css` | Typography tokens, view-transition styles, guidance/handoff styles |
| `next.config.ts` | `experimental.viewTransition: true` |
| `tests/unit/brain-guidance.test.ts` | Guidance map + handoff helpers (new) |
| `tests/unit/brain-navigation.test.ts` | Path ↔ view mapping (new) |
| `tests/e2e/findex.spec.ts` | Handoff, guidance, reduced-motion, font-size, nav regression |
| Spec (reference only) | `docs/superpowers/specs/2026-07-20-findex-ux-cohesion-design.md` |

---

### Task 1: Guidance + handoff pure modules (TDD)

**Files:**
- Create: `lib/brain/guidance.ts`
- Create: `lib/brain/navigation.ts`
- Create: `tests/unit/brain-guidance.test.ts`
- Create: `tests/unit/brain-navigation.test.ts`

**Interfaces:**
- Consumes: nothing from later tasks
- Produces:
  - `export type DemoView = "brain" | "spending" | "portfolio" | "cash-flow"`
  - `export type BrainHandoff = { source: Exclude<DemoView, "brain">; label: string; prompt: string }`
  - `export type GuidancePage = { chips: string[]; helpTitle: string; helpBody: string; capabilities: Array<{ title: string; detail: string }> }`
  - `export function getGuidance(view: DemoView): GuidancePage`
  - `export function getTryNextPrompts(view: DemoView): string[]`
  - `export function createHandoff(source: Exclude<DemoView, "brain">, prompt: string): BrainHandoff`
  - `export function viewFromPath(pathname: string): DemoView`
  - `export const GUIDANCE_DISMISS_KEY = "findex-guidance-dismiss-v1"`

- [ ] **Step 1: Write failing unit tests**

Create `tests/unit/brain-guidance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createHandoff, getGuidance, getTryNextPrompts, type DemoView } from "@/lib/brain/guidance";

const views: DemoView[] = ["brain", "spending", "portfolio", "cash-flow"];

describe("brain guidance", () => {
  it("provides chips and help for every demo view", () => {
    for (const view of views) {
      const page = getGuidance(view);
      expect(page.chips.length).toBeGreaterThanOrEqual(2);
      expect(page.helpTitle.length).toBeGreaterThan(0);
      expect(page.helpBody.length).toBeGreaterThan(0);
      expect(page.capabilities).toHaveLength(3);
    }
  });

  it("creates a spending handoff with a plain-language label", () => {
    const handoff = createHandoff("spending", "Where did my money go last month?");
    expect(handoff).toEqual({
      source: "spending",
      label: "Spending",
      prompt: "Where did my money go last month?",
    });
  });

  it("returns try-next prompts for brain", () => {
    expect(getTryNextPrompts("brain").length).toBeGreaterThanOrEqual(2);
  });
});
```

Create `tests/unit/brain-navigation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { viewFromPath } from "@/lib/brain/navigation";

describe("viewFromPath", () => {
  it("maps demo paths", () => {
    expect(viewFromPath("/demo/brain")).toBe("brain");
    expect(viewFromPath("/demo/spending")).toBe("spending");
    expect(viewFromPath("/demo/portfolio")).toBe("portfolio");
    expect(viewFromPath("/demo/cash-flow")).toBe("cash-flow");
  });

  it("defaults unknown paths to brain", () => {
    expect(viewFromPath("/")).toBe("brain");
    expect(viewFromPath("/demo/unknown")).toBe("brain");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- tests/unit/brain-guidance.test.ts tests/unit/brain-navigation.test.ts`  
Expected: FAIL — modules not found

- [ ] **Step 3: Implement modules**

Create `lib/brain/navigation.ts`:

```ts
export type DemoView = "brain" | "spending" | "portfolio" | "cash-flow";

export function viewFromPath(pathname: string): DemoView {
  const candidate = pathname.split("/").filter(Boolean).at(-1);
  return candidate === "spending" || candidate === "portfolio" || candidate === "cash-flow" ? candidate : "brain";
}
```

Create `lib/brain/guidance.ts` with the full static map (chips/help/capabilities for each view), `createHandoff` mapping source→label (`Spending` / `Portfolio` / `Cash flow`), and `getTryNextPrompts` returning 2 prompts that differ from the last asked topic when possible. Export `DemoView` re-export from navigation or define once in `guidance.ts` and import in navigation — **prefer defining `DemoView` only in `lib/brain/navigation.ts` and importing it into `guidance.ts`.**

Minimum chip content (exact strings for E2E):

- brain: `"Where did my money go last month?"`, `"Can I afford a car next month?"`, `"Build a safe-to-spend planner"`
- spending: `"Where did my money go last month?"`, `"What bills and subscriptions are coming up?"`
- portfolio: `"How is my portfolio allocation balanced?"`, `"Explain my biggest holding"`
- cash-flow: `"What is safe to spend and how does my cash flow look?"`, `"Can I afford a car next month?"`

Capabilities (all views, same three titles): `Ask`, `Decide`, `Build a tool` with one-line details.

- [ ] **Step 4: Run unit tests — expect PASS**

Run: `npm run test:unit -- tests/unit/brain-guidance.test.ts tests/unit/brain-navigation.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/brain/guidance.ts lib/brain/navigation.ts tests/unit/brain-guidance.test.ts tests/unit/brain-navigation.test.ts
git commit -m "$(cat <<'EOF'
Add Brain guidance and navigation helpers for UX cohesion.

EOF
)"
```

---

### Task 2: Typography token scale (CSS)

**Files:**
- Modify: `app/globals.css` (`:root` and `.fd-*` / `.brain-*` font-size rules)

**Interfaces:**
- Consumes: none
- Produces: CSS variables `--fd-text-body`, `--fd-text-label`, `--fd-text-meta`, `--fd-text-caption`, `--fd-text-table`

- [ ] **Step 1: Add tokens to `:root`**

Immediately after existing `:root` color variables in `app/globals.css`, add:

```css
  --fd-text-body: 14.5px;
  --fd-text-label: 12.5px;
  --fd-text-meta: 12px;
  --fd-text-caption: 11px;
  --fd-text-table: 14px;
```

- [ ] **Step 2: Remap demo shell + brain readability hotspots**

Replace hard-coded tiny sizes on these selectors (keep fonts/colors):

| Selector family | New size |
|-----------------|----------|
| `.fd-sidebar button strong` | `var(--fd-text-label)` |
| `.fd-sidebar button small` | `var(--fd-text-meta)` |
| `.fd-topbar` labels / `.fd-as-of` | ≥ `var(--fd-text-meta)` |
| `.fd-page-heading p`, `.fd-brain-hero p` | `var(--fd-text-body)` |
| `.fd-data-table` / transaction cells | `var(--fd-text-table)` |
| `.brain-messages .message`, `.brain-input` | `var(--fd-text-body)` |
| `.suggestion` chips | `var(--fd-text-label)` |
| `.fd-metric-row article span` / `small` | label/meta tokens |
| Eyebrows (`.fd-eyebrow`) | `var(--fd-text-caption)` (min 11px) |

Do **not** shrink display serif `h1` clamps; only bump mobile floors slightly if a media query sets them below ~42px for page headings.

Landing page hero type may stay as-is (marketing surface); focus on `/demo/*` shell.

- [ ] **Step 3: Smoke-check in browser or Playwright later**

For this task, run: `npm run lint`  
Expected: PASS (CSS-only)

Optional local: `npm run dev` and open `/demo/spending` — transaction rows should read clearly without zoom.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "$(cat <<'EOF'
Raise demo typography to a comfortable readable scale.

EOF
)"
```

---

### Task 3: View Transitions config + navigation helper

**Files:**
- Modify: `next.config.ts`
- Modify: `lib/brain/navigation.ts`
- Modify: `app/globals.css`
- Modify: `tests/unit/brain-navigation.test.ts`

**Interfaces:**
- Consumes: `DemoView` from Task 1
- Produces: `navigateWithTransition(router, href: string): void` where `router` is Next `AppRouterInstance` (`{ push(href: string): void }`)

- [ ] **Step 1: Enable experimental view transitions**

In `next.config.ts`, add to `nextConfig`:

```ts
  experimental: {
    viewTransition: true,
  },
```

- [ ] **Step 2: Extend navigation helper**

Add to `lib/brain/navigation.ts`:

```ts
type TransitionRouter = { push: (href: string) => void };

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function navigateWithTransition(router: TransitionRouter, href: string): void {
  if (prefersReducedMotion() || typeof document === "undefined" || !("startViewTransition" in document)) {
    router.push(href);
    return;
  }
  document.startViewTransition(() => {
    router.push(href);
  });
}
```

Add a unit test that calls `navigateWithTransition` with a mock router when `matchMedia` returns reduced motion — expect immediate `push` (mock `window.matchMedia` in the test).

- [ ] **Step 3: Add CSS view-transition + fallback rules**

Append to `app/globals.css`:

```css
::view-transition-old(fd-view-stage),
::view-transition-new(fd-view-stage) {
  animation-duration: 220ms;
  animation-timing-function: ease;
}

::view-transition-old(fd-page-title),
::view-transition-new(fd-page-title),
::view-transition-old(fd-ask-brain),
::view-transition-new(fd-ask-brain) {
  animation-duration: 260ms;
  animation-timing-function: ease;
}

.fd-view-stage {
  view-transition-name: fd-view-stage;
}

.fd-page-heading > div:first-child,
.fd-brain-hero {
  view-transition-name: fd-page-title;
}

.fd-ask-button {
  view-transition-name: fd-ask-brain;
}

@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation: none !important;
  }

  .fd-view-stage,
  .fd-page-heading > div:first-child,
  .fd-brain-hero,
  .fd-ask-button {
    view-transition-name: none;
  }
}
```

- [ ] **Step 4: Run unit tests**

Run: `npm run test:unit -- tests/unit/brain-navigation.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add next.config.ts lib/brain/navigation.ts tests/unit/brain-navigation.test.ts app/globals.css
git commit -m "$(cat <<'EOF'
Enable view transitions for calm demo navigation.

EOF
)"
```

---

### Task 4: Presentational components — Guidance, Handoff, MetricHint

**Files:**
- Create: `components/brain/brain-guidance.tsx`
- Create: `components/brain/brain-handoff-banner.tsx`
- Create: `components/dashboard/metric-hint.tsx`
- Modify: `app/globals.css` (component styles)

**Interfaces:**
- Consumes: `getGuidance`, `DemoView`, `GUIDANCE_DISMISS_KEY`, `BrainHandoff`
- Produces:
  - `BrainGuidance({ view, onSelectChip, disabled? })`
  - `BrainHandoffBanner({ handoff, onDismiss })`
  - `MetricHint({ children })`

- [ ] **Step 1: Implement `MetricHint`**

```tsx
export function MetricHint({ children }: { children: React.ReactNode }) {
  return <p className="fd-metric-hint">{children}</p>;
}
```

- [ ] **Step 2: Implement `BrainHandoffBanner`**

```tsx
"use client";

import { X } from "lucide-react";
import type { BrainHandoff } from "@/lib/brain/guidance";

export function BrainHandoffBanner({ handoff, onDismiss }: { handoff: BrainHandoff; onDismiss: () => void }) {
  return (
    <div className="fd-brain-handoff" role="status" aria-label="Brain handoff context">
      <p>
        <strong>From {handoff.label}</strong>
        <span> — asking: {handoff.prompt}</span>
      </p>
      <button type="button" aria-label="Dismiss handoff" onClick={onDismiss}><X size={14} /></button>
    </div>
  );
}
```

- [ ] **Step 3: Implement `BrainGuidance`**

- Load `getGuidance(view)`.
- Render chips as buttons calling `onSelectChip(prompt)`.
- Render a muted `?` button (`aria-label="What can the Financial Brain do?"`) that toggles a popover with `helpTitle`, `helpBody`, and the three capabilities.
- Close popover on Escape and outside click.
- Optional session dismiss: if `sessionStorage.getItem(GUIDANCE_DISMISS_KEY) === "1"`, still show chips but you may hide a one-time tip line; keep `?` always available.
- Use classes `fd-brain-guidance`, `fd-guidance-chips`, `fd-guidance-help`, `fd-guidance-popover`.

- [ ] **Step 4: Add CSS** for handoff banner, guidance chips/popover, metric hint — lightweight borders, no hero cards, match emerald/paper theme. Use `var(--fd-text-*)` sizes.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/brain/brain-guidance.tsx components/brain/brain-handoff-banner.tsx components/dashboard/metric-hint.tsx app/globals.css
git commit -m "$(cat <<'EOF'
Add Brain guidance, handoff banner, and metric hint UI.

EOF
)"
```

---

### Task 5: Wire `FinDexApp` — transitions, handoff, stage

**Files:**
- Modify: `components/dashboard/findex-app.tsx`

**Interfaces:**
- Consumes: `viewFromPath`, `navigateWithTransition`, `createHandoff`, `BrainHandoff`, components from Task 4
- Produces: `askBrain(prompt, source?)`, `handoff` state, `onHandoffDismiss`, `onBrainSend` clear

- [ ] **Step 1: Replace local `DemoView` / `viewFromPath` with imports from `lib/brain/navigation`**

- [ ] **Step 2: Add handoff state and update ask/navigate**

```tsx
const [handoff, setHandoff] = useState<BrainHandoff | null>(null);

const navigate = (next: DemoView) => navigateWithTransition(router, `/demo/${next}`);

const askBrain = (prompt: string, source?: Exclude<DemoView, "brain">) => {
  setWidgetPrompt(prompt);
  if (source) setHandoff(createHandoff(source, prompt));
  else setHandoff(null);
  navigate("brain");
};
```

Clear handoff when `view !== "brain"` in a small `useEffect`, or when leaving Brain via `navigate`.

- [ ] **Step 3: Wrap swapping content**

Wrap the conditional view mains in:

```tsx
<div className="fd-view-stage">
  {/* existing view === ... branches */}
</div>
```

On Brain home, above `BrainPanel` (or inside the stage header area):

```tsx
{handoff && (
  <BrainHandoffBanner handoff={handoff} onDismiss={() => setHandoff(null)} />
)}
<BrainGuidance
  view="brain"
  disabled={false}
  onSelectChip={(prompt) => {
    setWidgetPrompt(prompt);
  }}
/>
```

Pass into `BrainPanel`:

```tsx
onUserSend={() => setHandoff(null)}
```

(Add this prop in Task 6 / Task 7 — if implementing wire-up together, add the prop stub now.)

Update glance / page `askBrain` call sites later in Task 6; for Brain-only chips that should send immediately, either set `widgetPrompt` (consumed by panel) or call a send API — prefer `setWidgetPrompt(prompt)` so existing `initialPrompt` effect runs.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`  
Expected: PASS (may fail until Task 7 adds `onUserSend` — if so, implement Task 7 next in the same session before committing, or add optional prop with default no-op temporarily:

```ts
onUserSend?: () => void;
```

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/findex-app.tsx
git commit -m "$(cat <<'EOF'
Wire view transitions and Brain handoff state into the app shell.

EOF
)"
```

---

### Task 6: Detail pages — guidance, ask meta, metric hints

**Files:**
- Modify: `components/dashboard/spending-view.tsx`
- Modify: `components/dashboard/portfolio-view.tsx`
- Modify: `components/dashboard/cash-flow-view.tsx`
- Modify: `components/dashboard/findex-app.tsx` (callback signatures)

**Interfaces:**
- Consumes: `BrainGuidance`, `MetricHint`, `askBrain(prompt, source)`
- Produces: Updated `onAskBrain: (prompt: string) => void` wrappers that pass source

- [ ] **Step 1: Update `FinDexApp` view props**

```tsx
{view === "spending" && <main><SpendingView dataset={dataset} onAskBrain={(prompt) => askBrain(prompt, "spending")} /></main>}
{view === "portfolio" && <main><PortfolioView dataset={dataset} onAskBrain={(prompt) => askBrain(prompt, "portfolio")} /></main>}
{view === "cash-flow" && <main><CashFlowView dataset={dataset} onAskBrain={(prompt) => askBrain(prompt, "cash-flow")} /></main>}
```

- [ ] **Step 2: Spending**

Under the page heading (after Ask button row), render:

```tsx
<BrainGuidance view="spending" onSelectChip={(prompt) => onAskBrain(prompt)} />
```

Keep Ask button calling `onAskBrain("Where did my money go last month?")`.

- [ ] **Step 3: Portfolio**

Add `BrainGuidance view="portfolio"`.  
Under the allocation drift paragraph (or hero metric for net worth), add:

```tsx
<MetricHint>Drift is how far today&apos;s mix sits from Jordan&apos;s saved target — small gaps are normal.</MetricHint>
```

near the largest-drift copy.

- [ ] **Step 4: Cash flow**

Add `BrainGuidance view="cash-flow"`.  
Under Safe to spend featured metric:

```tsx
<MetricHint>Cash you can use now while keeping the checking safety buffer intact.</MetricHint>
```

Under runway / lowest balance summary:

```tsx
<MetricHint>Lowest point on the forecast — as long as it stays above the buffer, the plan holds.</MetricHint>
```

Inline “Ask the Brain about this month” keeps using `onAskBrain(...)` (source injected by parent).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/spending-view.tsx components/dashboard/portfolio-view.tsx components/dashboard/cash-flow-view.tsx components/dashboard/findex-app.tsx
git commit -m "$(cat <<'EOF'
Add page-aware Brain guidance and metric hints on detail views.

EOF
)"
```

---

### Task 7: BrainPanel — welcome, try-next, handoff clear on send

**Files:**
- Modify: `components/brain/brain-panel.tsx`
- Modify: `components/dashboard/findex-app.tsx` (pass `onUserSend`)

**Interfaces:**
- Consumes: `getTryNextPrompts`, optional `onUserSend?: () => void`
- Produces: Clearer intro message; try-next chip row after last assistant message when not busy

- [ ] **Step 1: Update intro message**

Replace the initial assistant `content` with:

```ts
"I can help in three ways: Ask about your money, Decide on a purchase, or Build a custom tool. I’m grounded in Jordan’s demo spending, income, cash flow, and portfolio."
```

- [ ] **Step 2: Add `onUserSend` prop and call it at the start of `send`**

```ts
onUserSend?: () => void;
// inside send(), before network work:
onUserSend?.();
```

- [ ] **Step 3: Try-next chips**

When `!busy && !pending && !isPristine` and the last message is assistant with non-empty content, render a row `aria-label="Try next"` with `getTryNextPrompts("brain").slice(0, 2)` as suggestion-style buttons that call `send(prompt)` (or open purchase form for afford-a-car).

Keep existing default `suggestions` when `isPristine`; when not pristine, prefer try-next over duplicating the full suggestion list (or show try-next above a collapsed set — **prefer replace** default suggestions after first exchange to reduce clutter).

- [ ] **Step 4: Pass `onUserSend` from FinDexApp**

```tsx
<BrainPanel
  onWorkspace={handleWorkspace}
  activeWorkspace={artifact}
  initialPrompt={widgetPrompt}
  onPromptConsumed={() => setWidgetPrompt(null)}
  onUserSend={() => setHandoff(null)}
/>
```

- [ ] **Step 5: Unit/typecheck**

Run: `npm run typecheck && npm run test:unit`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/brain/brain-panel.tsx components/dashboard/findex-app.tsx
git commit -m "$(cat <<'EOF'
Clarify Brain welcome and clear handoff when the user sends.

EOF
)"
```

---

### Task 8: Playwright E2E — UX cohesion coverage

**Files:**
- Modify: `tests/e2e/findex.spec.ts`

**Interfaces:**
- Consumes: UI copy/aria from Tasks 4–7; existing `enterDemo`, `mockBrain`

- [ ] **Step 1: Update Brain heading assertion if hero copy unchanged**

Hero `h1` stays “Ask about your money, or test a decision.” — keep existing assertion. Update intro-dependent assertions only if they look for old assistant text.

- [ ] **Step 2: Add tests** (append to `findex.spec.ts`)

```ts
test("ask the brain from spending shows handoff and runs the prompt", async ({ page }) => {
  await mockBrain(page);
  await enterDemo(page);
  await page.getByRole("button", { name: /^Spending/ }).click();
  await page.getByRole("button", { name: /Ask the Brain/ }).click();
  await expect(page).toHaveURL(/\/demo\/brain$/);
  await expect(page.getByRole("status", { name: "Brain handoff context" })).toContainText("From Spending");
  await expect(page.getByText(/\$366\.21|dining out last month/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Dismiss handoff" }).click();
  await expect(page.getByRole("status", { name: "Brain handoff context" })).toHaveCount(0);
});

test("page guidance help explains ask decide build", async ({ page }) => {
  await enterDemo(page);
  await page.getByRole("button", { name: "What can the Financial Brain do?" }).click();
  await expect(page.getByText("Ask", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Decide", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Build a tool", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");
});

test("reduced motion still navigates between views", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterDemo(page);
  await page.getByRole("button", { name: /^Portfolio/ }).click();
  await expect(page).toHaveURL(/\/demo\/portfolio$/);
  await expect(page.getByRole("heading", { name: "Your long-term money, in one picture." })).toBeVisible();
});

test("spending table and brain composer meet comfortable font sizes", async ({ page }) => {
  await enterDemo(page);
  const brainInput = page.getByLabel("Message the Financial Brain");
  const brainSize = await brainInput.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(brainSize).toBeGreaterThanOrEqual(14);
  await page.goto("/demo/spending");
  const cell = page.locator(".fd-data-table td, table td").first();
  await expect(cell).toBeVisible();
  const tableSize = await cell.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(tableSize).toBeGreaterThanOrEqual(13);
});
```

Also extend the existing routed journey test to assert guidance chips exist on Spending (`getByRole("button", { name: "Where did my money go last month?" })`).

- [ ] **Step 3: Run E2E**

Run: `npm run test:e2e`  
Expected: all Playwright tests PASS (including new ones). If a selector fails, fix UI aria/copy to match the tests — tests encode the spec.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/findex.spec.ts
git commit -m "$(cat <<'EOF'
Cover Brain handoff, guidance, motion, and type size in E2E.

EOF
)"
```

---

### Task 9: Full FE/BE verification gate + manual checklist

**Files:** none required (fixes only if gates fail)

- [ ] **Step 1: Unit + integration + lint + build**

Run: `npm run validate`  
Expected: TypeScript clean, Vitest unit+integration PASS, ESLint PASS, production build PASS

- [ ] **Step 2: E2E**

Run: `npm run test:e2e`  
Expected: PASS

- [ ] **Step 3: Final local verify**

Because this initiative is UI-primary and should not touch sandbox/generator, run:

```bash
npm run verify:local
```

If sandbox/generator/workflow files were **not** modified, and `verify:local` is too heavy in CI time locally, minimum acceptable documented gate is `validate` + `test:e2e`, with note in the commit/PR: `UI-only — live/sandbox gates not required`. Prefer running `verify:local` once before merge.

- [ ] **Step 4: Manual checklist (from spec)**

- [ ] Rapid nav across four pages — shell stable, no hard flash  
- [ ] Shared-element morph or calm fade  
- [ ] Spending + Brain readable without zoom (desktop + ~390px)  
- [ ] Chips / `?` make Ask · Decide · Build obvious  
- [ ] Theme still Findex (paper/emerald/serif)  
- [ ] (Dev) workspace build not cancelled by UI transitions  

- [ ] **Step 5: Final commit only if Step 4 required fixes**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix verification findings from UX cohesion release gate.

EOF
)"
```

---

## Spec coverage checklist (self-review)

| Spec requirement | Task |
|------------------|------|
| View Transitions + shared elements + reduced motion | 3, 5 |
| Comfortable typography tokens | 2, 8 (assert) |
| Hybrid chips + `?` | 1, 4, 5, 6, 8 |
| Handoff banner + clear on send/dismiss | 1, 4, 5, 7, 8 |
| Metric one-liners (safe to spend, drift, runway) | 4, 6 |
| Brain welcome Ask/Decide/Build | 7 |
| Try-next chips | 7, 8 (optional assert) |
| No backend contract changes | All tasks (UI/CSS/helpers only) |
| FE matrix E2E | 8 |
| BE regression via validate | 9 |
| `validate` + `test:e2e` ship gate | 9 |

## Placeholder / consistency review

- Types: `DemoView` owned by `lib/brain/navigation.ts`; `BrainHandoff` by `lib/brain/guidance.ts`.
- `askBrain(prompt, source?)` and `onUserSend` naming consistent across Tasks 5–7.
- No TBD/TODO left in tasks.
- Approach 2 soft-SPA explicitly out of scope unless Task 9 manual check still shows flicker after View Transitions — then open a follow-up, do not expand this plan mid-flight.

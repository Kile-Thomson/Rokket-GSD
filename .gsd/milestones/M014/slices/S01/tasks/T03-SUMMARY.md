---
id: T03
parent: S01
milestone: M014
provides:
  - Worker card rendering in auto-progress webview widget
  - Budget alert badge in stats area
  - Graceful degradation when no parallel workers exist
key_files:
  - src/webview/auto-progress.ts
  - src/webview/__tests__/auto-progress.test.ts
  - src/webview/styles.css
key_decisions:
  - Budget bar fill clamped to 100% width but color indicates overspend (red at >=100%)
patterns_established:
  - Worker card HTML builder pattern with per-state CSS classes and budget threshold color changes
observability_surfaces:
  - DOM: .gsd-auto-progress-worker-card elements inside #autoProgressWidget
  - DOM: .gsd-auto-progress-budget-alert badge when budgetAlert is true
  - DOM: .stale class on worker cards with stale heartbeats
duration: 8m
verification_result: passed
completed_at: 2026-03-19
blocker_discovered: false
---

# T03: Render parallel worker cards in webview progress widget with tests

**Added worker card grid to auto-progress widget with state badges, budget bars, stale indicators, and 10 new tests**

## What Happened

Added `buildWorkerCards(data)` function to the webview auto-progress module that renders a flex-wrap grid of worker cards when `data.workers` is non-null and non-empty. Each card displays: worker milestone ID, state badge (Running/Paused/Stopped/Error with distinct colors), current unit description or "Idle", cost, and a budget bar with green/orange/red fill thresholds at 80% and 100%. Stale workers are dimmed via `.stale` CSS class and show "(stale)" text. A budget alert badge ("⚠️ Budget") appears in the stats area when `data.budgetAlert` is true.

Added CSS styles for all worker card elements using VS Code theme variables for dark/light compatibility. Extended the test suite with 10 new tests covering all rendering paths including edge cases. This is the final task in slice S01 — all slice verification checks pass.

## Verification

- `npx vitest run src/webview/__tests__/auto-progress.test.ts` — 29/29 tests pass (19 existing + 10 new)
- `npx vitest run src/extension/__tests__/parallel-status.test.ts` — 14/14 tests pass
- `npm run build` — clean build, no type errors

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `npx vitest run src/webview/__tests__/auto-progress.test.ts` | 0 | ✅ pass | 1.0s |
| 2 | `npx vitest run src/extension/__tests__/parallel-status.test.ts` | 0 | ✅ pass | 0.3s |
| 3 | `npm run build` | 0 | ✅ pass | 1.9s |

## Diagnostics

- Inspect `#autoProgressWidget` in webview DevTools to verify `.gsd-auto-progress-worker-card` elements render with correct state classes and budget bar fill widths.
- Budget alert badge: look for `.gsd-auto-progress-budget-alert` element in the stats area.
- Stale workers: check for `.stale` class on card elements and "(stale)" text in state badge.
- When `data.workers` is null/empty, no `.gsd-auto-progress-workers` container is rendered (graceful degradation).

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/webview/auto-progress.ts` — Added `buildWorkerCards()`, `formatWorkerState()`, `buildWorkerBudgetBar()` functions and wired into `render()`; added budget alert badge to `buildStats()`
- `src/webview/__tests__/auto-progress.test.ts` — Added `makeWorker()` helper and 10 new test cases for worker card rendering
- `src/webview/styles.css` — Added CSS for worker card grid, card styling, state badge colors, budget bar track/fill with threshold classes
- `.gsd/milestones/M014/slices/S01/tasks/T03-PLAN.md` — Added Observability Impact section

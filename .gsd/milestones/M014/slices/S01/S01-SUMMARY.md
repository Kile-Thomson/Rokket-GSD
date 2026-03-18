---
id: S01
parent: M014
milestone: M014
provides:
  - WorkerProgress type and AutoProgressData.workers/budgetAlert fields
  - readParallelWorkers() and readBudgetCeiling() pure filesystem readers
  - Parallel worker integration in AutoProgressPoller.poll() with budget percentage computation
  - Budget alert VS Code warning toast at 80% threshold with duplicate prevention
  - Worker card grid rendering in auto-progress webview widget with state badges, budget bars, stale indicators
  - Graceful degradation when .gsd/parallel/ is absent
requires: []
affects:
  - S02
  - S03
key_files:
  - src/shared/types.ts
  - src/extension/parallel-status.ts
  - src/extension/__tests__/parallel-status.test.ts
  - src/extension/auto-progress.ts
  - src/webview/auto-progress.ts
  - src/webview/__tests__/auto-progress.test.ts
  - src/webview/styles.css
key_decisions:
  - Unknown worker state values default to "error" rather than throwing
  - budgetPercent computed by poller (not reader) — reader stays pure, poller owns budget ceiling lookup
  - Budget alert toast fires once per crossing, resets when all workers drop below 80%
  - Budget bar fill clamped to 100% width but color indicates overspend (red at >=100%)
  - 30s TTL cache for budget ceiling to avoid re-parsing preferences.md every 3s poll
patterns_established:
  - Dropbox conflicted copy filtering via /^[^(]+\.status\.json$/ filename pattern
  - Pure filesystem reader functions with null-return semantics for missing data
  - 30s TTL cache pattern for infrequently-changing config values
  - One-shot toast with boolean guard to prevent duplicates across poll cycles
  - Worker card HTML builder pattern with per-state CSS classes and budget threshold color changes
observability_surfaces:
  - Output channel logs "Parallel workers: N" per poll when workers present
  - Output channel logs "Budget alert fired for: ..." on toast trigger
  - DOM .gsd-auto-progress-worker-card elements inside #autoProgressWidget
  - DOM .gsd-auto-progress-budget-alert badge when budgetAlert is true
  - DOM .stale class on worker cards with stale heartbeats
drill_down_paths:
  - .gsd/milestones/M014/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M014/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M014/slices/S01/tasks/T03-SUMMARY.md
duration: 21m
verification_result: passed
completed_at: 2026-03-19
---

# S01: Parallel Worker Progress & Budget Alerts

**Per-worker progress cards with state badges, budget bars, and 80% budget alert toast for parallel auto-mode, with graceful degradation to current behavior when no parallel data exists**

## What Happened

Built the full parallel worker visibility feature across three tasks in a clean bottom-up sequence.

**T01** laid the foundation with the `WorkerProgress` interface in shared types and two pure filesystem reader functions. `readParallelWorkers(cwd)` reads `.gsd/parallel/*.status.json`, filters Dropbox conflicted copies via regex, parses JSON with try/catch to skip corrupt files, computes a stale flag from heartbeat timestamps, and returns null for missing/empty directories. `readBudgetCeiling(cwd)` parses `budget_ceiling` from `.gsd/preferences.md`. Both functions follow null-return semantics — callers check for null to determine whether parallel data is available. 14 unit tests cover all edge cases.

**T02** wired the readers into `AutoProgressPoller.poll()`. After existing dashboard data fetch, the poller calls both readers, computes `budgetPercent = cost / budgetCeiling` per worker, and populates the `workers` and `budgetAlert` fields on `AutoProgressData`. A 30s TTL cache avoids re-parsing preferences.md on every 3s poll. A boolean guard (`lastBudgetAlertFired`) prevents duplicate toasts — the alert fires once when any worker crosses 80%, resets when all drop below, enabling re-firing on subsequent crossings. Worker count and budget alerts are logged to the output channel.

**T03** added the webview rendering. `buildWorkerCards(data)` renders a flex-wrap grid of worker cards when `data.workers` is non-null. Each card shows milestone ID, state badge (Running/Paused/Stopped/Error with distinct colors), current unit description, cost, and a budget bar with green→orange→red fill at 80%/100% thresholds. Stale workers are dimmed with a "(stale)" label. A budget alert badge appears in the stats area when `budgetAlert` is true. When `data.workers` is null, no worker UI renders — identical to pre-slice behavior. 10 new tests bring the auto-progress test suite to 29 tests.

## Verification

- `npx vitest run src/extension/__tests__/parallel-status.test.ts` — 14/14 tests pass (reader edge cases)
- `npx vitest run src/webview/__tests__/auto-progress.test.ts` — 29/29 tests pass (19 existing + 10 new worker card tests)
- `npm run build` — clean build, no type errors, extension 144KB + webview 331KB
- No regressions across the full test suite (265 tests, 15 files)

## Deviations

None. All three tasks executed exactly as planned.

## Known Limitations

- Parallel worker rendering is tested with unit tests and fixture data but requires manual UAT against gsd-pi 2.28.0 with actual parallel auto-mode to confirm end-to-end behavior
- Budget ceiling is read from `.gsd/preferences.md` — if gsd-pi changes the format or location, the reader will return null (graceful degradation, but no budget bars)
- Stale threshold is hardcoded at 30 seconds — not configurable

## Follow-ups

- Manual UAT with gsd-pi 2.28.0 parallel auto-mode to validate live rendering
- Consider making stale threshold configurable if feedback suggests 30s is too aggressive/lenient

## Files Created/Modified

- `src/shared/types.ts` — Added `WorkerProgress` interface and `workers`/`budgetAlert` fields to `AutoProgressData`
- `src/extension/parallel-status.ts` — New module with `readParallelWorkers()` and `readBudgetCeiling()` pure functions
- `src/extension/__tests__/parallel-status.test.ts` — 14 unit tests covering all reader edge cases
- `src/extension/auto-progress.ts` — Wired parallel readers into poll loop, added budget ceiling cache, alert guard, and output channel logging
- `src/webview/auto-progress.ts` — Added `buildWorkerCards()`, `formatWorkerState()`, `buildWorkerBudgetBar()` functions, budget alert badge in stats
- `src/webview/__tests__/auto-progress.test.ts` — 10 new worker card rendering tests
- `src/webview/styles.css` — CSS for worker card grid, state badges, budget bar with threshold colors

## Forward Intelligence

### What the next slice should know
- `AutoProgressData.workers` is `WorkerProgress[] | null` and `budgetAlert` is boolean — both are already on the shared type. S02 and S03 extend `AutoProgressData` for their own fields without touching the worker fields.
- The poll loop in `auto-progress.ts` now has a clear pattern for adding new filesystem reads: read → cache → compute → attach to progress data → send to webview. Follow the same pattern for any new data sources.
- Webview rendering in `auto-progress.ts` uses a builder function pattern (`buildWorkerCards`, `buildStats`, etc.) that returns HTML strings composed into the main `render()` function.

### What's fragile
- The `.gsd/parallel/*.status.json` filename filter uses `/^[^(]+\.status\.json$/` to reject Dropbox conflicted copies — any change to Dropbox's conflict naming pattern would need a regex update.
- Budget ceiling parsing is a simple line scan for `budget_ceiling:` in preferences.md — if the format gains YAML front matter or nested sections, the parser may need updating.

### Authoritative diagnostics
- GSD output channel shows `Parallel workers: N` on every poll cycle when workers are present — if this line is missing, the parallel directory isn't being found or is empty.
- `#autoProgressWidget` in webview DevTools → look for `.gsd-auto-progress-worker-card` elements to confirm rendering.

### What assumptions changed
- Original roadmap mentioned `.gsd/runtime/` for parallel worker state — actual gsd-pi uses `.gsd/parallel/*.status.json`. The plan was updated before execution; this is the confirmed format.
